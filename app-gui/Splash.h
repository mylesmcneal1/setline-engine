// set.Line desktop app: the loading window (docs/branding-and-loading.md, docs/design/loading-*.reference.html).
//
// A 720 x 440 borderless window, rounded 14 px, drawn natively (dark from the first frame, no web view, no white
// flash), shown the moment set.Line starts. The approved icon and wordmark SVGs are drawn as they are; only the
// icon's playhead moves. A checklist of the real start-up steps (Audio, Show, Waveforms, Cues), each with a
// spinner while it runs and a tick + detail when done; the section strip at the bottom is the progress bar
// (colours revealed behind the white playhead), and progress never goes backwards. "· Ready", then it fades and
// the main window shows. It stays at least ~700 ms so a fast start doesn't flash. "Reduce motion": no sweeping or
// spinning, the strip just fills. The same window shows what went wrong, with the choices.
#pragma once
#include <juce_gui_basics/juce_gui_basics.h>
#include <functional>
#include <vector>

namespace setline::gui {

class Splash : public juce::Component, private juce::Timer {
public:
    // Closing it (taskbar, Alt+F4) quits set.Line, like the main window.
    void userTriedToCloseWindow() override { juce::JUCEApplication::getInstance()->systemRequestedQuit(); }
    enum class State { pending, running, done, failed };
    enum Step { audio = 0, show, waveforms, cues, numSteps };

    explicit Splash(const juce::String& version);
    ~Splash() override;

    // detail: shown after the label ("USB Audio · ASIO · 48 kHz · 128"); fraction: progress within a running step.
    void setStep(Step s, State st, const juce::String& detail = {}, float fraction = 0);
    // All done: "· Ready", then fade out; whenGone runs as the fade starts (show the main window there).
    void finish(std::function<void()> whenGone);
    bool finished() const { return finishing; }

    // Something's wrong: title, one line of help, the choices (first = primary). Replaces the checklist.
    struct Choice { juce::String label; std::function<void()> act; };
    void showError(const juce::String& title, const juce::String& body, std::vector<Choice> choices);
    void clearError();

    void paint(juce::Graphics& g) override;
    void mouseMove(const juce::MouseEvent& e) override;
    void mouseUp(const juce::MouseEvent& e) override;

    static bool reduceMotion();

private:
    void timerCallback() override;
    float target() const;
    void paintLoading(juce::Graphics& g);
    void paintError(juce::Graphics& g);
    void drawStrip(juce::Graphics& g, juce::Rectangle<float> r, float reveal, bool playhead);

    struct Row { juce::String label, detail; State state = State::pending; float fraction = 0; };
    Row rows[numSteps];
    juce::String version;
    std::unique_ptr<juce::Drawable> icon, playhead, wordmark;
    float shown = 0;             // displayed progress 0..1 (eases toward target, never back)
    double started = 0, readyAt = 0, fadeFrom = 0;
    bool finishing = false, motion = true;
    std::function<void()> onGone;
    float spin = 0;

    bool error = false;
    juce::String errTitle, errBody;
    std::vector<Choice> choices;
    std::vector<juce::Rectangle<float>> buttonRects;
    int hover = -1;
};

} // namespace setline::gui
