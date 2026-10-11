#!/usr/bin/env python3
"""supertonic_synth.py — CLI tipis untuk Supertonic TTS (dipakai pipeline Node).

Contoh:
    python3 scripts/supertonic_synth.py --text "Halo dunia." --out /tmp/a.wav --voice M2

Model diunduh otomatis ke ~/.cache/supertonic3 saat pertama dipakai
(butuh NO_PROXY bersih bila ada proxy di env).
"""
import argparse
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--voice", default="M2")
    ap.add_argument("--lang", default="id")
    args = ap.parse_args()

    text = args.text.strip()
    if not text:
        print("teks kosong", file=sys.stderr)
        return 2

    import supertonic
    import soundfile as sf

    tts = supertonic.TTS()
    style = tts.get_voice_style(args.voice)
    wav_data, sr = tts.synthesize(text, style, lang=args.lang)
    sf.write(args.out, wav_data[0], 44100)
    print(f"OK {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
