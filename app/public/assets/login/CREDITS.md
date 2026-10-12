# Fotos e vídeo da tela de login

Todas sob **Unsplash License** (uso comercial e modificação liberados, sem exigência de
atribuição — mantemos o crédito por cortesia). Baixadas em 2026-10-12 via
`https://images.unsplash.com/photo-<id>?w=1600&q=80`, convertidas para WebP com Pillow
(`quality=78`, hero) e recortadas para os avatares (160×160, `quality=80`).

| Arquivo | Origem (id Unsplash) | Autor (conforme catálogo Unsplash) | Uso |
|---|---|---|---|
| `team-hero.webp` (1600×1067, ~96 KB) | `photo-1522202176988-66273c2fd55f` | Brooke Cagle — https://unsplash.com/@brookecagle | Fundo do painel (desktop) e faixa superior (mobile) |
| `avatar-1.webp` (160×160) | `photo-1573496359142-b8d87734a5a2` | Christina @ wocintechchat.com — https://unsplash.com/@wocintechchat | Avatar da prova social |
| `avatar-2.webp` (160×160) | `photo-1543269865-cbf427effbad` | Brooke Cagle — https://unsplash.com/@brookecagle | Avatar da prova social |
| `avatar-3.webp` (160×160) | recorte de `photo-1522202176988-66273c2fd55f` | Brooke Cagle | Avatar da prova social |

Licença: https://unsplash.com/license

Para trocar uma foto: baixe a nova, converta com
`python3 -c "from PIL import Image; Image.open('x.jpg').convert('RGB').save('team-hero.webp', quality=78)"`,
mantenha ≤ 250 KB e atualize esta tabela. Os caminhos ficam em
`app/src/pages/login/loginContent.ts`.

## Vídeo ambiente (painel desktop)

| Arquivo | Origem | Autor | Licença | Trecho |
|---|---|---|---|---|
| `team-ambient.mp4` (1280×720, 24 fps, 12 s, ~1,0 MB) · `team-ambient.webm` (~1,0 MB) · `team-poster.webp` (1º frame, ~36 KB) | https://www.pexels.com/video/people-laughing-at-the-office-8125933/ (arquivo `8125933-hd_1920_1080_25fps.mp4`) | Ivan S — https://www.pexels.com/@ivan-s | Pexels License (uso comercial, sem atribuição exigida) — https://www.pexels.com/license/ | 0:08–0:21 do original (0:20–0:21 cruzado sobre o início para loop sem salto), sem áudio |

Baixado em 2026-10-12. Comandos de transcodificação em `docs/rebranding-copysync.md`
(subseção "Tela de login"). `team-hero.webp` segue como fundo do banner mobile.
