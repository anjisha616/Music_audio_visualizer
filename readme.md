# SONIQ — Audio Visualizer

A modern, interactive web-based audio visualizer that splits music into stems (Kick Drum, Snare/Toms, Hi-Hats/Cymbals, Bass, Guitar/Keys, Vocals) and displays real-time, animated visualizations for each.

## Features
- Drag & drop or click to load audio files
- Full mix and per-stem (STEM VIEW) visualization
- Animated, color-coded panels for each instrument group:
  - Kick Drum: Shockwave rings and energy waveform
  - Snare/Toms: Crackle bars and transient flashes
  - Hi-Hats/Cymbals: Shimmering particles and spectrum bars
  - Bass: Deep pulsing bars
  - Guitar/Keys: Dual-layer waveforms
  - Vocals: Symmetric breathing waveform
- Multiple color palettes and visualization modes
- Responsive design for desktop and mobile

## Recent Bugfixes
- Fixed unwanted scroll bar by hiding overflow on html/body
- Fixed repeated sliding animation in Kick Drum and Snare/Toms panels (history buffer now correctly mapped to canvas width)

## Usage
1. Open `index.html` in your browser (or use a local server for best results)
2. Click or drag an audio file to load
3. Switch between Full Mix and Stem View using the top-right buttons
4. Enjoy the real-time visualizations!

---

Made with ❤️ by Anji
