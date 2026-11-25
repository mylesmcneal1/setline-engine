# MIDI clock soak test on the band's Mac

The same 60-minute soak the PC runs, on the show machine (2015 MacBook Pro, macOS 12) with the Audient iD14 at a
128-sample buffer and MIDI clock going to the IAC Driver (a virtual MIDI port built into macOS, so no MIDI hardware is
needed). Pass: `RESULT: PASS`, which means no xruns, no disk underruns, no MIDI dropped, every MIDI send (clock and
the program changes) under 2 ms late, and no audio callback over 70 % of its budget.

Takes about 70 minutes, most of it waiting. Plug the laptop into power, plug in the iD14, and quit set.Line and every
other app first (nothing else running while it plays).

## 1. Turn on the IAC Driver (once)

1. Open **Audio MIDI Setup** (Applications › Utilities).
2. **Window › Show MIDI Studio**.
3. Double-click **IAC Driver**.
4. Tick **Device is online**. Leave the port name as it is (**Bus 1**). Click **Apply**, close the window.

## 2. Get the spike (the command-line test program)

In Terminal:

```
setline-update --spike
```

That installs the latest set.Line and puts the spike in `~/setline-spike`. Then:

```
cd ~/setline-spike
./setline-spike --list
```

Check that the list shows the iD14 under **CoreAudio** and **IAC Driver Bus 1** under MIDI outputs.

## 3. Make the test song (once, about 590 MB)

```
./setline-spike --make-test test-song --stems 8 --seconds 240
```

## 4. Run the soak (60 minutes)

```
./setline-spike --play test-song --driver CoreAudio --device "iD14" --buffer 128 --midi-port "IAC" --midi-clock --soak 60 2>&1 | tee soak-mac-1.log
```

- `--device "iD14"` matches any output whose name contains iD14.
- `--midi-port "IAC"` sends the song's program changes and the clock to the IAC Driver.
- `--midi-clock` sends MIDI clock (24 per beat, following the song's tempo) on that port all the time, also between
  loops, exactly as set.Line does with Clock on.

Don't touch the Mac while it runs. A status line prints every 10 seconds.

## 5. What to send back

The last lines of `soak-mac-1.log` (from `Summary` down), and any lines starting with `LATE`. Each `LATE` line says
which message was late, by how much, whether the program woke up late or the MIDI driver call blocked, and what it was
doing just before. For example:

```
  LATE clock F8 port 0: 38.20 ms late (woke 0.02 ms late, the driver call took 38.10 ms); before it: ...
```

The file is in `~/setline-spike/soak-mac-1.log`.

## Notes

- These flags were checked against the spike's own help text (`./setline-spike` with no arguments) and run the same
  way on the PC (with loopMIDI in place of the IAC Driver).
- The 2015 MacBook is the reference machine: if it passes here, timing is good enough for the show.
