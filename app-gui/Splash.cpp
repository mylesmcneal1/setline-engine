#include "Splash.h"
#include "SetLineBrand.h"

#if JUCE_WINDOWS
 #include <windows.h>
#endif

namespace setline::gui {

void setWindowIcon(void* nativeHandle); // WinIcon.cpp

#if JUCE_MAC
bool setlineReduceMotionMac(); // MacDrop.mm
#endif

namespace {
const juce::Colour bg(0xff0b0c0e), hair(0xff22262d), text(0xffe9ebef), secondary(0xff8a909b), track(0xff2a2f37), ring(0xff3a3f48),
                   amber(0xfff5a524), okFill(0xff1f6f4d), ready(0xff2fbf71), body(0xffb4b9c2), bad(0xffff6b5e);
// The section strip: Intro, Verse, Pre, Chorus, Bridge, Outro (flex 8 / 16 / 8 / 16 / 8 / 6, 3 px apart).
const float flex[] = { 8, 16, 8, 16, 8, 6 };
const juce::Colour stripColours[] = { juce::Colour(0xff6b7cff), juce::Colour(0xff22c3a6), juce::Colour(0xffa46bff),
                                      juce::Colour(0xfff5a524), juce::Colour(0xffff5fa2), juce::Colour(0xff7d8696) };
constexpr float W = 720, H = 440;
// How much each step weighs in the progress bar.
const float weights[] = { 0.15f, 0.15f, 0.45f, 0.25f };

std::unique_ptr<juce::XmlElement> svgXml(const char* resource)
{
    int size = 0;
    const char* data = SetLineBrand::getNamedResource(resource, size);
    return data != nullptr ? juce::XmlDocument::parse(juce::String::fromUTF8(data, size)) : nullptr;
}

juce::Font font(float h, bool bold = false, bool semi = false)
{
    juce::Font f(juce::FontOptions().withHeight(h));
    if (bold || semi) f = f.boldened();
    return f;
}
// Text width (JUCE 8 measures through a glyph arrangement).
float widthOf(const juce::Font& f, const juce::String& t)
{
    juce::GlyphArrangement ga;
    ga.addLineOfText(f, t, 0, 0);
    return ga.getBoundingBox(0, -1, true).getWidth();
}
} // namespace

bool Splash::reduceMotion()
{
   #if JUCE_WINDOWS
    BOOL anim = TRUE;
    if (SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, &anim, 0)) return ! anim;
    return false;
   #elif JUCE_MAC
    return setlineReduceMotionMac();
   #else
    return false;
   #endif
}

Splash::Splash(const juce::String& v) : version(v)
{
    // The approved icon, as it is; its playhead (the last two shapes) is drawn on its own so it can sweep.
    if (auto xml = svgXml("setlineicon_svg")) {
        auto base = std::make_unique<juce::XmlElement>(*xml), ph = std::make_unique<juce::XmlElement>(*xml);
        const int n = xml->getNumChildElements();
        for (int i = n - 1; i >= n - 2 && i >= 0; --i) base->removeChildElement(base->getChildElement(i), true);
        // the playhead keeps the other shapes as invisible geometry, so it's laid out in the icon's own frame
        for (int i = n - 3; i >= 0; --i) if (auto* e = ph->getChildElement(i)) e->setAttribute("fill", "none");
        icon = juce::Drawable::createFromSVG(*base);
        playhead = juce::Drawable::createFromSVG(*ph);
    }
    if (auto xml = svgXml("setlinewordmarktextonly_svg")) wordmark = juce::Drawable::createFromSVG(*xml);

    const char* labels[] = { "Audio", "Show", "Waveforms", "Cues" };
    for (int i = 0; i < numSteps; ++i) rows[i].label = labels[i];
    motion = ! reduceMotion();

    setOpaque(false); // rounded corners
    setSize((int) W, (int) H);
    addToDesktop(juce::ComponentPeer::windowAppearsOnTaskbar);
    if (auto* p = getPeer()) setWindowIcon(p->getNativeHandle()); // its taskbar button has the app icon too
    centreWithSize((int) W, (int) H);
    setAlwaysOnTop(true); // a loading window stays in front until the main window takes over
    setVisible(true);
    toFront(true);
    started = juce::Time::getMillisecondCounterHiRes();
    startTimerHz(60);
}

Splash::~Splash() { stopTimer(); }

void Splash::setStep(Step s, State st, const juce::String& detail, float fraction)
{
    auto& r = rows[s];
    r.state = st;
    if (detail.isNotEmpty() || st == State::done) r.detail = detail;
    r.fraction = juce::jlimit(0.0f, 1.0f, fraction);
    repaint();
}

float Splash::target() const
{
    float t = 0;
    for (int i = 0; i < numSteps; ++i)
        t += weights[i] * (rows[i].state == State::done ? 1.0f : rows[i].state == State::running ? 0.1f + 0.85f * rows[i].fraction : 0.0f);
    return juce::jlimit(0.0f, 1.0f, t);
}

void Splash::finish(std::function<void()> whenGone)
{
    if (finishing) return;
    for (auto& r : rows) if (r.state != State::done) { r.state = State::done; }
    finishing = true;
    // 7a: never wait on a timer: the main window shows now, and this window fades out over it
    shown = 1.0f;
    readyAt = fadeFrom = juce::Time::getMillisecondCounterHiRes();
    if (whenGone) whenGone();
}

void Splash::showError(const juce::String& title, const juce::String& b, std::vector<Choice> c)
{
    error = true; errTitle = title; errBody = b; choices = std::move(c); hover = -1;
    toFront(true);
    repaint();
}

void Splash::clearError() { error = false; choices.clear(); buttonRects.clear(); repaint(); }

void Splash::timerCallback()
{
    const double now = juce::Time::getMillisecondCounterHiRes();
    // Ease toward the real progress; never backwards.
    const float t = finishing ? 1.0f : target();
    if (t > shown) shown = juce::jmin(t, shown + juce::jmax(0.004f, (t - shown) * 0.12f));
    spin = std::fmod(spin + 1.0f / (0.8f * 60.0f), 1.0f);
    if (finishing && ! error) {
        if (fadeFrom > 0) {
            const float a = (float) juce::jmax(0.0, 1.0 - (now - fadeFrom) / 180.0);
            setAlpha(a);
            if (a <= 0) { stopTimer(); setVisible(false); return; }
        }
    }
    repaint();
}

void Splash::drawStrip(juce::Graphics& g, juce::Rectangle<float> r, float reveal, bool withPlayhead)
{
    float sum = 0;
    for (float f : flex) sum += f;
    const float gap = 3, unit = (r.getWidth() - gap * 5) / sum;
    const float revealX = r.getX() + reveal * r.getWidth();
    float x = r.getX();
    for (int i = 0; i < 6; ++i) {
        const auto seg = juce::Rectangle<float>(x, r.getY(), flex[i] * unit, r.getHeight());
        g.setColour(track);
        g.fillRoundedRectangle(seg, 3);
        if (revealX > seg.getX()) {
            juce::Graphics::ScopedSaveState s(g);
            g.reduceClipRegion(seg.withRight(juce::jmin(seg.getRight(), revealX)).getSmallestIntegerContainer());
            g.setColour(stripColours[i]);
            g.fillRoundedRectangle(seg, 3);
        }
        x += seg.getWidth() + gap;
    }
    if (withPlayhead) {
        g.setColour(juce::Colours::white);
        g.fillRoundedRectangle(juce::Rectangle<float>(revealX - 1, r.getY() - 6, 2, 18), 1);
    }
}

void Splash::paint(juce::Graphics& g)
{
    const auto area = getLocalBounds().toFloat();
    g.setColour(bg);
    g.fillRoundedRectangle(area, 14);
    g.setColour(hair);
    g.drawRoundedRectangle(area.reduced(0.5f), 14, 1);
    if (error) paintError(g); else paintLoading(g);
}

void Splash::paintLoading(juce::Graphics& g)
{
    // Strip: 56 px side margins, 36 px from the bottom, 6 px tall.
    const auto strip = juce::Rectangle<float>(56, H - 36 - 6, W - 112, 6);
    // Icon (132 px) left; to its right the wordmark (its top level with the icon's top), "Beta …", the checklist.
    const float colH = 44 + 4 + 16 + 22 + 4 * 20 + 3 * 10;
    const float top = juce::jmax(40.0f, (strip.getY() - colH) / 2);
    const auto iconR = juce::Rectangle<float>(56, top, 132, 132);
    if (icon) icon->drawWithin(g, iconR, juce::RectanglePlacement::stretchToFit, 1);
    if (playhead) {
        // The icon's playhead sweeps across its bars with the progress (-22 → +26 in the icon's 100-unit grid).
        const float dx = (motion ? (-22.0f + 48.0f * shown) : 0.0f) * iconR.getWidth() / 100.0f;
        juce::Graphics::ScopedSaveState s(g);
        g.addTransform(juce::AffineTransform::translation(dx, 0));
        playhead->drawWithin(g, iconR, juce::RectanglePlacement::stretchToFit, 1);
    }
    const float x = 56 + 132 + 40;
    float y = top;
    if (wordmark) { // 44 px type: the wordmark's paths are 100-unit type; place the glyphs' top at the icon's top
        const auto pb = wordmark->getOutlineAsPath().getBounds();
        const float k = 0.44f;
        wordmark->draw(g, 1, juce::AffineTransform::translation(-pb.getX(), -pb.getY()).scaled(k).translated(x, top));
        y = top + pb.getHeight() * k;
    }
    y += 6;
    g.setFont(font(13));
    g.setColour(secondary);
    const juce::String beta = "Beta " + version;
    g.drawText(beta, juce::Rectangle<float>(x, y, 300, 16), juce::Justification::centredLeft);
    if (readyAt > 0) {
        g.setColour(ready);
        g.setFont(font(13, false, true));
        g.drawText(juce::String::fromUTF8(" \xc2\xb7 Ready"), juce::Rectangle<float>(x + widthOf(font(13), beta), y, 120, 16), juce::Justification::centredLeft);
    }
    y += 16 + 22;
    for (int i = 0; i < numSteps; ++i) {
        const auto& r = rows[i];
        const auto c = juce::Rectangle<float>(x, y + 2, 16, 16).getCentre();
        if (r.state == State::done) {
            g.setColour(okFill); g.fillEllipse(c.x - 7, c.y - 7, 14, 14);
            juce::Path tick; tick.startNewSubPath(c.x - 3.2f, c.y + 0.3f); tick.lineTo(c.x - 1.1f, c.y + 2.4f); tick.lineTo(c.x + 3.2f, c.y - 2.2f);
            g.setColour(juce::Colours::white); g.strokePath(tick, juce::PathStrokeType(1.8f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
        } else if (r.state == State::failed) {
            g.setColour(bad); g.fillEllipse(c.x - 7, c.y - 7, 14, 14);
            g.setColour(juce::Colours::white); g.fillRect(c.x - 0.9f, c.y - 4, 1.8f, 5.0f); g.fillRect(c.x - 0.9f, c.y + 2.2f, 1.8f, 1.8f);
        } else {
            g.setColour(ring); g.drawEllipse(c.x - 6.5f, c.y - 6.5f, 13, 13, 1.5f);
            if (r.state == State::running) {
                juce::Path arc;
                const float a0 = (motion ? spin : 0.0f) * juce::MathConstants<float>::twoPi;
                arc.addCentredArc(c.x, c.y, 6.5f, 6.5f, 0, a0, a0 + juce::MathConstants<float>::halfPi, true);
                g.setColour(amber); g.strokePath(arc, juce::PathStrokeType(2.5f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
            }
        }
        g.setFont(font(14));
        g.setColour(r.state == State::pending ? secondary : text);
        g.drawText(r.label, juce::Rectangle<float>(x + 26, y, 120, 20), juce::Justification::centredLeft);
        if (r.detail.isNotEmpty() && r.state != State::pending) {
            g.setColour(secondary);
            const float lw = widthOf(font(14), r.label);
            g.drawText(r.detail, juce::Rectangle<float>(x + 26 + lw + 10, y, W - (x + 26 + lw + 10) - 40, 20), juce::Justification::centredLeft, true);
        }
        y += 30;
    }
    drawStrip(g, strip, shown, motion || shown > 0);
}

void Splash::paintError(juce::Graphics& g)
{
    g.setFont(font(12));
    g.setColour(secondary);
    g.drawText("Loading", juce::Rectangle<float>(W - 32 - 200, 28, 200, 16), juce::Justification::centredRight);
    g.drawText("Beta " + version, juce::Rectangle<float>(32, H - 28 - 16, 300, 16), juce::Justification::centredLeft);
    // the wordmark at 54 px, centred, with the strip under it: two sections done, the second in red
    float y = 92;
    if (wordmark) {
        const auto pb = wordmark->getOutlineAsPath().getBounds();
        const float k = 0.54f;
        wordmark->draw(g, 1, juce::AffineTransform::translation(-pb.getX(), -pb.getY()).scaled(k).translated((W - pb.getWidth() * k) / 2, y));
        y += pb.getHeight() * k + 12;
    }
    {
        const auto r = juce::Rectangle<float>((W - 230) / 2, y, 230, 6);
        float sum = 0; for (float f : flex) sum += f;
        const float unit = (r.getWidth() - 15) / sum;
        float x = r.getX();
        for (int i = 0; i < 6; ++i) {
            g.setColour(i == 0 ? stripColours[0] : i == 1 ? bad : track);
            g.fillRoundedRectangle(juce::Rectangle<float>(x, r.getY(), flex[i] * unit, 6), 2);
            x += flex[i] * unit + 3;
        }
        y += 6 + 26;
    }
    g.setColour(text);
    g.setFont(font(18, false, true));
    g.drawText(errTitle, juce::Rectangle<float>(40, y, W - 80, 24), juce::Justification::centred);
    y += 24 + 8;
    g.setColour(body);
    g.setFont(font(14));
    g.drawFittedText(errBody, juce::Rectangle<int>((int) (W - 480) / 2, (int) y, 480, 44), juce::Justification::centredTop, 2);
    y += 44 + 18;
    // the choices: primary (amber), secondary (dark), the last one outlined
    buttonRects.clear();
    float total = 0;
    std::vector<float> widths;
    for (auto& c : choices) { widths.push_back(widthOf(font(14, false, true), c.label) + 36); total += widths.back(); }
    total += 10.0f * (float) juce::jmax(0, (int) choices.size() - 1);
    float x = (W - total) / 2;
    for (size_t i = 0; i < choices.size(); ++i) {
        const auto r = juce::Rectangle<float>(x, y, widths[i], 40);
        buttonRects.push_back(r);
        const bool primary = i == 0, outline = i > 0 && i == choices.size() - 1 && choices.size() > 2;
        const float lift = hover == (int) i ? 0.08f : 0.0f;
        if (primary) { g.setColour(amber.brighter(lift)); g.fillRoundedRectangle(r, 8); g.setColour(juce::Colour(0xff1a1000)); }
        else if (outline) { g.setColour(track.brighter(lift)); g.drawRoundedRectangle(r.reduced(0.5f), 8, 1); g.setColour(body); }
        else { g.setColour(hair.brighter(lift)); g.fillRoundedRectangle(r, 8); g.setColour(text); }
        g.setFont(font(14, false, primary));
        g.drawText(choices[i].label, r, juce::Justification::centred);
        x += widths[i] + 10;
    }
}

void Splash::mouseMove(const juce::MouseEvent& e)
{
    int h = -1;
    for (size_t i = 0; i < buttonRects.size(); ++i) if (buttonRects[i].contains(e.position)) h = (int) i;
    if (h != hover) { hover = h; setMouseCursor(h >= 0 ? juce::MouseCursor::PointingHandCursor : juce::MouseCursor::NormalCursor); repaint(); }
}

void Splash::mouseUp(const juce::MouseEvent& e)
{
    if (! error) return;
    for (size_t i = 0; i < buttonRects.size(); ++i)
        if (buttonRects[i].contains(e.position) && i < choices.size()) {
            auto act = choices[i].act;
            clearError();
            if (act) act();
            return;
        }
}

} // namespace setline::gui
