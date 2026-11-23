#include "Platform.h"

#if defined(_WIN32)
 #ifndef NOMINMAX
  #define NOMINMAX
 #endif
 #ifndef WIN32_LEAN_AND_MEAN
  #define WIN32_LEAN_AND_MEAN
 #endif
 #include <windows.h>
 #include <mmsystem.h>
 #include <avrt.h>
 #include <thread>
 #ifndef CREATE_WAITABLE_TIMER_HIGH_RESOLUTION
  #define CREATE_WAITABLE_TIMER_HIGH_RESOLUTION 0x00000002
 #endif
 #ifndef PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION
  #define PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION 0x4
 #endif
#elif defined(__APPLE__)
 #include <pthread.h>
 #include <sys/qos.h>
 #include <thread>
#else
 #include <pthread.h>
 #include <thread>
#endif

namespace setline::platform {

#if defined(_WIN32)

void enableHighResolutionTimers()
{
    timeBeginPeriod(1);
    // Windows 11 ignores timer-resolution requests (and slows timers down) for processes it thinks
    // the user can't see, such as a console app behind other windows. Opt out of both.
    PROCESS_POWER_THROTTLING_STATE s {};
    s.Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION;
    s.ControlMask = PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION | PROCESS_POWER_THROTTLING_EXECUTION_SPEED;
    s.StateMask = 0;
    SetProcessInformation(GetCurrentProcess(), ProcessPowerThrottling, &s, sizeof s);
}

void preciseSleep(std::chrono::microseconds d)
{
    thread_local HANDLE timer = CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
    if (timer) {
        LARGE_INTEGER due; due.QuadPart = -(LONGLONG) d.count() * 10; // relative, in 100 ns units
        if (SetWaitableTimer(timer, &due, 0, nullptr, nullptr, FALSE)) { WaitForSingleObject(timer, INFINITE); return; }
    }
    std::this_thread::sleep_for(d);
}
void restoreTimers() { timeEndPeriod(1); }

void makeThisThreadTimeCritical()
{
    DWORD taskIndex = 0;
    AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex); // best effort; harmless if MMCSS is unavailable
    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);
}

void makeThisThreadHighPriority() { SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL); }

#elif defined(__APPLE__)

void enableHighResolutionTimers() {}
void restoreTimers() {}
void makeThisThreadTimeCritical() { pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE, 0); }
void makeThisThreadHighPriority() { pthread_set_qos_class_self_np(QOS_CLASS_USER_INITIATED, 0); }
void preciseSleep(std::chrono::microseconds d) { std::this_thread::sleep_for(d); }

#else

void enableHighResolutionTimers() {}
void restoreTimers() {}
void makeThisThreadTimeCritical() {}
void makeThisThreadHighPriority() {}
void preciseSleep(std::chrono::microseconds d) { std::this_thread::sleep_for(d); }

#endif

} // namespace setline::platform
