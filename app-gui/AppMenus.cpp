#include "AppMenus.h"

namespace setline::gui {

AppMenus::AppMenus(std::function<void(const juce::String&)> s) : send(std::move(s))
{
    // 9e: the menus' commands come here. Without this JUCE looks for a target from the focused component (the web
    // view), finds none, and a chosen menu item silently does nothing.
    commands.setFirstCommandTarget(this);
}

AppMenus::~AppMenus()
{
   #if JUCE_MAC
    if (attachedMac) juce::MenuBarModel::setMacMainMenu(nullptr);
   #endif
    if (window != nullptr) window->setMenuBar(nullptr);
}

juce::KeyPress AppMenus::parseKey(const juce::String& key)
{
    if (key.isEmpty()) return {};
    juce::StringArray parts; parts.addTokens(key.toLowerCase(), "+", "");
    int mods = 0; juce::String k;
    for (auto& p : parts) {
        if (p == "cmd") mods |= juce::ModifierKeys::commandModifier;
        else if (p == "ctrl") mods |= juce::ModifierKeys::ctrlModifier;
        else if (p == "shift") mods |= juce::ModifierKeys::shiftModifier;
        else if (p == "alt" || p == "opt") mods |= juce::ModifierKeys::altModifier;
        else k = p;
    }
    int code = 0;
    if (k == "left") code = juce::KeyPress::leftKey; else if (k == "right") code = juce::KeyPress::rightKey;
    else if (k == "up") code = juce::KeyPress::upKey; else if (k == "down") code = juce::KeyPress::downKey;
    else if (k == "backspace") code = juce::KeyPress::backspaceKey; else if (k == "delete") code = juce::KeyPress::deleteKey;
    else if (k == "space") code = juce::KeyPress::spaceKey; else if (k == "return" || k == "enter") code = juce::KeyPress::returnKey;
    else if (k == "comma") code = ','; else if (k == "minus") code = '-'; else if (k == "plus" || k == "equals") code = '=';
    else if (k.length() == 1) code = (int) k.toUpperCase()[0];
    if (code == 0) return {};
    return juce::KeyPress(code, juce::ModifierKeys(mods), 0);
}

void AppMenus::collect(const juce::var& items)
{
    if (auto* a = items.getArray())
        for (auto& it : *a) {
            if ((bool) it["sep"] || it.hasProperty("sub")) { collect(it["sub"]); continue; }
            const auto id = it["id"].toString(); if (id.isEmpty()) continue;
            juce::CommandID c;
            if (auto f = idToCmd.find(id); f != idToCmd.end()) c = f->second; else { c = nextCmd++; idToCmd[id] = c; }
            byCmd[c] = { id, it["label"].toString(), parseKey(it["key"].toString()), ! (bool) it["dis"], (bool) it["check"] };
        }
}

void AppMenus::setMenus(const juce::var& s)
{
    spec = s;
    byCmd.clear();
    if (auto* m = spec["menus"].getArray()) for (auto& menu : *m) collect(menu["items"]);
    collect(spec["app"]);
    commands.clearCommands();
    commands.registerAllCommandsForTarget(this);
    // the shortcuts the menus show (and, on the Mac, their key equivalents)
    if (auto* km = commands.getKeyMappings()) {
        km->resetToDefaultMappings();
    }
   #if JUCE_MAC
    appMenu = build(spec["app"]);
    if (attachedMac) juce::MenuBarModel::setMacMainMenu(this, &appMenu);
   #endif
    menuItemsChanged();
}

void AppMenus::attach(juce::DocumentWindow* w)
{
    window = w;
   #if JUCE_MAC
    juce::ignoreUnused(w);
    appMenu = build(spec["app"]);
    juce::MenuBarModel::setMacMainMenu(this, &appMenu);
    attachedMac = true;
   #else
    if (window != nullptr) window->setMenuBar(this, 26);
   #endif
}

juce::StringArray AppMenus::getMenuBarNames()
{
    juce::StringArray n;
    if (auto* m = spec["menus"].getArray()) for (auto& menu : *m) n.add(menu["name"].toString());
    return n;
}

juce::PopupMenu AppMenus::build(const juce::var& items)
{
    juce::PopupMenu m;
    if (auto* a = items.getArray())
        for (auto& it : *a) {
            if ((bool) it["sep"]) { m.addSeparator(); continue; }
            if (it.hasProperty("header")) { m.addSectionHeader(it["header"].toString()); continue; } // 10b: File › Import / Export
            if (it.hasProperty("sub")) { m.addSubMenu(it["label"].toString(), build(it["sub"]), ! (bool) it["dis"]); continue; }
            const auto f = idToCmd.find(it["id"].toString()); if (f == idToCmd.end()) continue;
            juce::PopupMenu::Item item(it["label"].toString());
            item.setID(f->second).setEnabled(! (bool) it["dis"]).setTicked((bool) it["check"]);
            item.commandManager = &commands; // shows the shortcut; runs perform() below
            m.addItem(std::move(item));
        }
    return m;
}

juce::PopupMenu AppMenus::getMenuForIndex(int index, const juce::String&)
{
    if (auto* m = spec["menus"].getArray(); m && index >= 0 && index < m->size()) return build((*m)[index]["items"]);
    return {};
}

void AppMenus::getAllCommands(juce::Array<juce::CommandID>& c) { for (auto& [id, _] : byCmd) c.add(id); }

void AppMenus::getCommandInfo(juce::CommandID id, juce::ApplicationCommandInfo& info)
{
    auto f = byCmd.find(id); if (f == byCmd.end()) return;
    info.setInfo(f->second.label, f->second.label, "Menu", 0);
    info.setActive(f->second.enabled);
    info.setTicked(f->second.ticked);
    if (f->second.key.isValid()) info.addDefaultKeypress(f->second.key.getKeyCode(), f->second.key.getModifiers());
}

bool AppMenus::perform(const InvocationInfo& info)
{
    auto f = byCmd.find(info.commandID); if (f == byCmd.end()) return false;
    if (send) send(f->second.id);
    return true;
}

bool AppMenus::invokeLikeMenu(const juce::String& id)
{
    const auto f = idToCmd.find(id); if (f == idToCmd.end()) return false;
    std::function<bool(const juce::PopupMenu&)> walk = [&](const juce::PopupMenu& m) {
        for (juce::PopupMenu::MenuItemIterator it(m); it.next();) {
            auto& item = it.getItem();
            if (item.subMenu != nullptr && walk(*item.subMenu)) return true;
            if (item.itemID == f->second && item.commandManager != nullptr) {
                // what JUCE's menu bars (the Mac main menu, the Windows MenuBarComponent) do with a chosen item
                juce::ApplicationCommandTarget::InvocationInfo info(item.itemID);
                info.invocationMethod = juce::ApplicationCommandTarget::InvocationInfo::fromMenu;
                item.commandManager->invoke(info, true);
                return true;
            }
        }
        return false;
    };
    const auto names = getMenuBarNames();
    for (int i = 0; i < names.size(); ++i) if (walk(getMenuForIndex(i, names[i]))) return true;
    return walk(build(spec["app"]));
}

} // namespace setline::gui
