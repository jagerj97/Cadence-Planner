"""Makes the notification sounds in android/app/src/main/res/raw (16-bit mono WAV).

Run from anywhere: python3 android/tools/make_sounds.py

- cadence_jingle / cadence_jingle_done: a cat toy's little bell, shaken (reminders / a timer that
  finished). Used while Cadence is inside.
- cadence_chime / cadence_chime_done: the soft two- and three-note chime the app played before,
  note for note. Used with Cadence outside.
"""
import math, os, random, struct, wave

RATE = 44100
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'app', 'src', 'main', 'res', 'raw'))


def save(name, samples):
    peak = max(1e-9, max(abs(s) for s in samples))
    # A short fade in and out so it never clicks.
    n = len(samples)
    for i in range(min(64, n)):
        samples[i] *= i / 64
        samples[n - 1 - i] *= i / 64
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(s / peak * 0.85 * 32767)) for s in samples))


def chime(notes, length):
    """Sine notes 0.18s apart, each rising for 20ms and fading over 0.6s (the old Web Audio chime)."""
    out = [0.0] * int(RATE * length)
    for k, f in enumerate(notes):
        t0 = k * 0.18
        for i in range(int(RATE * 0.65)):
            t = i / RATE
            j = int((t0 + t) * RATE)
            if j >= len(out):
                break
            # linear up to 1 in 20ms, then exponential down to 1/1800 at 0.6s
            env = t / 0.02 if t < 0.02 else math.exp(math.log(0.0001 / 0.18) * (t - 0.02) / 0.58)
            out[j] += env * math.sin(2 * math.pi * f * t)
    return out


def jingle(shakes, length, seed):
    """Two small jingle bells, each strike an inharmonic ring with a tick of rattle, in quick shakes."""
    rnd = random.Random(seed)
    out = [0.0] * int(RATE * length)
    bells = [2230.0, 2610.0]
    # Partials of a small spherical bell (ratio, strength, decay in seconds).
    partials = [(1.0, 1.0, 0.22), (2.32, 0.55, 0.12), (4.25, 0.3, 0.07), (6.63, 0.18, 0.045)]
    strikes = []
    for start in shakes:
        t = start
        for _ in range(rnd.randint(4, 6)):
            strikes.append((t, rnd.choice(bells) * rnd.uniform(0.985, 1.015), rnd.uniform(0.45, 1.0)))
            t += rnd.uniform(0.028, 0.055)
    for t0, f, amp in strikes:
        j0 = int(t0 * RATE)
        phases = [rnd.uniform(0, 2 * math.pi) for _ in partials]
        for i in range(int(RATE * 0.5)):
            j = j0 + i
            if j >= len(out):
                break
            t = i / RATE
            s = 0.0
            for (ratio, strength, decay), ph in zip(partials, phases):
                s += strength * math.exp(-t / decay) * math.sin(2 * math.pi * f * ratio * t + ph)
            # the pellet hitting the shell: a very short burst of noise
            if t < 0.006:
                s += 0.35 * (1 - t / 0.006) * rnd.uniform(-1, 1)
            out[j] += amp * s
    return out


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    save('cadence_chime', chime([880, 660], 0.9))
    save('cadence_chime_done', chime([660, 880, 1100], 1.1))
    save('cadence_jingle', jingle([0.0, 0.34], 1.0, seed=7))
    save('cadence_jingle_done', jingle([0.0, 0.3, 0.62], 1.3, seed=11))
    print('wrote sounds to', OUT)
