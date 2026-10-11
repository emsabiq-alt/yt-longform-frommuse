# Pexels Fire Sparks Overlay

`fire-sparks-black.mp4` berasal dari file Vecteezy yang diberikan pengguna:
`vecteezy_loop-of-smoke-fire-sparks-rising-up-particle_7525563.mp4`.

Pipeline hanya menerapkannya pada footage Pexels. Latar hitam dibuang saat
render dengan filter FFmpeg `colorkey`; opacity dan toleransi key dapat diatur
melalui environment `PEXELS_OVERLAY_*`.
