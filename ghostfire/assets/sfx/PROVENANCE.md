# Звуки оружия и вспышка — 2026-09-12

12 записанных выстрелов: The Free Firearm Sound Library, Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney. Лицензия CC0. [Страница источника](https://opengameart.org/node/21826), [CC0](https://creativecommons.org/publicdomain/zero/1.0/), [архив](https://opengameart.org/sites/default/files/Prepared%20SFX%20Library.7z).

Выбраны near-distance записи. Один микрофонный канал, HP 45 Hz, presence +3 dB на 2800 Hz, пики −4 dBFS, короткий fade, PCM16 mono 44.1 kHz. Повторные выстрелы чередуют варианты, pitch меняется в пределах ±2%. Рейлган сочетает винтовочный удар с синтезированным разрядом. Писк попадания/хедшота отключён по отзыву пользователя; музыка не заменялась.

| Файл | Исходник | Начало, с | Длина, с | SHA256 |
| --- | --- | ---: | ---: | --- |
| pistol-1.wav | 1911/A_42P.wav | 0.93649 | 0.420 | 68c9bcb3b10d69f1086261590ac4354db520e8e30246cec97e570f6c7f802b50 |
| pistol-2.wav | 1911/A_42P.wav | 4.99655 | 0.420 | 292f36885f81feecba3a8638aada03735f2f89040c84b424780ef05b080df008 |
| smg-1.wav | Carl Gustav M45/G_31P.wav | 0.30655 | 0.160 | a487fe373b2dc09251f63059b36f273ff1f697c1be2f6a821f4da21c95a80910 |
| smg-2.wav | Carl Gustav M45/G_31P.wav | 3.49744 | 0.160 | a638864392e3278f00d89256a4bc09d93424ac2554b716bbc2f1f93bd87bf21b |
| smg-3.wav | Carl Gustav M45/G_31P.wav | 6.72408 | 0.160 | aa64bcb3f551665324d19ad551f5d6f2bca6e6219a1d446c3a64bab6271088c0 |
| assault-1.wav | AR-15/D_32P.wav | 0.70054 | 0.420 | e3cf8f58feed71556395a77ccace014a97f1a9bd45f6c9f0c7e5ffd77236416a |
| assault-2.wav | AR-15/D_32P.wav | 5.64415 | 0.420 | a7e180d7b6053e39c3873cadf8d037d1cf12396585d63eb2e8dd6e7720d60090 |
| shotgun-1.wav | Mossberg/N_30P.wav | 1.69181 | 0.750 | a51860d01e3419cfaff40cc3b2710ca5d9493a1c1db4102e244a4353daeaba81 |
| shotgun-2.wav | Mossberg/N_30P.wav | 4.95630 | 0.750 | bcd1d23e1bc9fd69e8159c59ce0de14e6b081e5adbbbee9ccd8b50f6263ee88c |
| sniper-1.wav | Mosin Nagant/M_21P.wav | 1.02986 | 1.100 | 3cb06f8803824df7856d92f9ff0c726c18f6535ffce4eb2c31b2b55948987f25 |
| sniper-2.wav | Mosin Nagant/M_21P.wav | 5.01585 | 1.100 | ff9bdd305e9fec9e32d20948aedbe3ac9d1006df3e4974e0a724f4d3e68c2c79 |
| sniper-3.wav | Mosin Nagant/M_21P.wav | 9.15168 | 1.100 | 6c789a87fb1f65c625369dd30f8f23ea473849d49d5b60a6adf485ce2af75af6 |

Вспышка: assets/vfx/muzzle-flash.png, встроенный image_gen, 2026-09-12. Исходный PNG с alpha скопирован без изменения. Общая текстура, отдельный SpriteMaterial игрока, 45–65 ms, размер по оружию.

Промпт:

> Create a production game VFX texture: one realistic firearm muzzle flash seen nearly head-on, centered in a square image, isolated on genuinely transparent background with alpha. Hot white-yellow small core, irregular short orange combustion tongues, subtle soft amber glow and fine wisps, realistic high speed photography character. Compact asymmetric organic flash, ample transparent margin, entire effect inside canvas. No gun, no scenery, no smoke cloud, no lettering, no watermark, no cartoon star, no borders. This is a single sprite for an FPS weapon muzzle using additive blending.
