# OTP Slingshot

A recreation of the "OTP Slingshot" verification screen from
[this Instagram reel](https://www.instagram.com/p/Ddji48yB8yu/), restyled as a dark, glassy,
neon HUD: load a digit into a slingshot, pull back, aim, and shoot it into the active slot of a
6-digit code. Every shot tells you whether that digit was right, which is the joke, and the
security log and hint panel lean into it.

No dependencies, no build step. Vanilla HTML, CSS and JavaScript.

```bash
python3 -m http.server 5320 --directory otp-slingshot
```

Registered in `.claude/launch.json` as **otp-slingshot** (port 5320).

## How to play

1. Click a digit in the tray (or press its key). It loads into the glowing orb on the band.
2. Drag the orb down and away from the fork. You get a dashed aim arc, a pointer, and a dotted
   predicted trajectory.
3. Release. The orb flies with projectile physics and leaves a light trail.
4. Landing on the slot row checks the digit against the active slot:
   - correct: the slot lights cyan, "Correct!" toast, particle burst, next slot activates
   - wrong: "N is incorrect. Try again!" toast, slot and screen shake, digit returns to the tray
   - missing the card shows a "Missed!" toast
5. Six correct digits open the "Access granted" modal with attempts, accuracy and time.
   "Enter System" starts a new round.

Extras: **Show hint** (or press `H`) reveals the code with solved digits in cyan and the next one
pulsing amber. The top-right HUD tracks attempts, accuracy and elapsed time. The security log
(desktop only) streams every event. The speaker icon toggles the WebAudio sound effects.

## Code

The OTP is fixed to `150787` to match the video. Add `?random` to the URL for a random code.

| File | What it holds |
|---|---|
| `index.html` | Layout, HUD, card, hint, slingshot (inline SVG), tray, log, modal |
| `styles.css` | Theme tokens, aurora/grid backdrop, glass panels, glow states, responsive rules |
| `script.js` | Game state, drag-to-aim with trajectory preview, flight, hit detection, FX canvas, sound |

Tunables sit at the top of `script.js`: pull distance, launch speed, gravity, aim-arc radius,
toast duration, trajectory dot count and the greeting name.
