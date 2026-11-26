// set.Line desktop app (9c): the menus in the window chrome. The page describes them (setMenus: labels, shortcuts,
// enabled / ticked, submenus) whenever they change; this builds the macOS menu bar (with the app menu) or the menu
// bar on the Windows window from that, and sends the chosen item back to the page as a "menu" event {cmd: id}.
// Shortcuts are shown in the menus; on the Mac they're also the menu's key equivalents (the page handles the same
// keys itself, so whichever sees the key first runs it, once).
#pragma once
#include <juce_gui_basics/juce_gui_basics.h>
#include <functional>
#include <map>

namespace setline::gui {

class AppMenus : public juce::MenuBarModel, private juce::ApplicationCommandTarget {
public:
    explicit AppMenus(std::function<void(const juce::String& cmd)> send);
    ~AppMenus() override;

    // {menus: [{name, items: [...]}], app: [...]} where an item is {id, label, key ("cmd+shift+n"), dis, check, sep,
    // sub: [...]}; app: the macOS application menu's items (About, Check for updates…, Settings…).
    void setMenus(const juce::var& spec);
    void attach(juce::DocumentWindow* window); // Mac: the main menu bar; Windows: the window's menu bar

    juce::StringArray getMenuBarNames() override;
    juce::PopupMenu getMenuForIndex(int index, const juce::String& name) override;
    void menuItemSelected(int, int) override {}

    // "cmd+shift+n" -> a KeyPress (cmd = ⌘ on the Mac, Ctrl on Windows); exposed for tests
    static juce::KeyPress parseKey(const juce::String& key);
    // 9e: runs the item with this id the way a click in the menu bar does (the item's command manager, async);
    // false if no item has that id. For the --menu-test self-test.
    bool invokeLikeMenu(const juce::String& id);

private:
    juce::ApplicationCommandTarget* getNextCommandTarget() override { return nullptr; }
    void getAllCommands(juce::Array<juce::CommandID>& commands) override;
    void getCommandInfo(juce::CommandID id, juce::ApplicationCommandInfo& info) override;
    bool perform(const InvocationInfo& info) override;

    juce::PopupMenu build(const juce::var& items);
    void collect(const juce::var& items);

    std::function<void(const juce::String&)> send;
    juce::var spec;
    juce::ApplicationCommandManager commands;
    struct Cmd { juce::String id, label; juce::KeyPress key; bool enabled = true, ticked = false; };
    std::map<juce::CommandID, Cmd> byCmd;
    std::map<juce::String, juce::CommandID> idToCmd;
    juce::CommandID nextCmd = 0x5e100;
    juce::DocumentWindow* window = nullptr;
    juce::PopupMenu appMenu;
    bool attachedMac = false;
};

} // namespace setline::gui
