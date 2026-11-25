// Clipes do painel real (gerados por scripts/clips.py a partir de material-real/).

import gerador169Mp4 from '../assets/media/gerador-169.mp4'
import gerador169Webm from '../assets/media/gerador-169.webm'
import gerador169Poster from '../assets/media/gerador-169.jpg'
import gerador45Mp4 from '../assets/media/gerador-45.mp4'
import gerador45Webm from '../assets/media/gerador-45.webm'
import gerador45Poster from '../assets/media/gerador-45.jpg'
import monitoramento169Mp4 from '../assets/media/monitoramento-169.mp4'
import monitoramento169Webm from '../assets/media/monitoramento-169.webm'
import monitoramento169Poster from '../assets/media/monitoramento-169.jpg'
import monitoramento45Mp4 from '../assets/media/monitoramento-45.mp4'
import monitoramento45Webm from '../assets/media/monitoramento-45.webm'
import monitoramento45Poster from '../assets/media/monitoramento-45.jpg'
import story169Mp4 from '../assets/media/story-169.mp4'
import story169Webm from '../assets/media/story-169.webm'
import story169Poster from '../assets/media/story-169.jpg'
import story45Mp4 from '../assets/media/story-45.mp4'
import story45Webm from '../assets/media/story-45.webm'
import story45Poster from '../assets/media/story-45.jpg'
import pagina169Mp4 from '../assets/media/pagina-169.mp4'
import pagina169Webm from '../assets/media/pagina-169.webm'
import pagina169Poster from '../assets/media/pagina-169.jpg'
import pagina45Mp4 from '../assets/media/pagina-45.mp4'
import pagina45Webm from '../assets/media/pagina-45.webm'
import pagina45Poster from '../assets/media/pagina-45.jpg'
import intercalar169Mp4 from '../assets/media/intercalar-169.mp4'
import intercalar169Webm from '../assets/media/intercalar-169.webm'
import intercalar169Poster from '../assets/media/intercalar-169.jpg'
import intercalar45Mp4 from '../assets/media/intercalar-45.mp4'
import intercalar45Webm from '../assets/media/intercalar-45.webm'
import intercalar45Poster from '../assets/media/intercalar-45.jpg'
import tutorial169Mp4 from '../assets/media/tutorial-169.mp4'
import tutorial169Webm from '../assets/media/tutorial-169.webm'
import tutorial169Poster from '../assets/media/tutorial-169.jpg'
import tutorial45Mp4 from '../assets/media/tutorial-45.mp4'
import tutorial45Webm from '../assets/media/tutorial-45.webm'
import tutorial45Poster from '../assets/media/tutorial-45.jpg'

export type ClipVariant = { mp4: string; webm: string; poster: string }
export type Clip = { wide: ClipVariant; tall: ClipVariant }

export const CLIPS = {
  gerador: {
    wide: { mp4: gerador169Mp4, webm: gerador169Webm, poster: gerador169Poster },
    tall: { mp4: gerador45Mp4, webm: gerador45Webm, poster: gerador45Poster },
  },
  monitoramento: {
    wide: { mp4: monitoramento169Mp4, webm: monitoramento169Webm, poster: monitoramento169Poster },
    tall: { mp4: monitoramento45Mp4, webm: monitoramento45Webm, poster: monitoramento45Poster },
  },
  story: {
    wide: { mp4: story169Mp4, webm: story169Webm, poster: story169Poster },
    tall: { mp4: story45Mp4, webm: story45Webm, poster: story45Poster },
  },
  pagina: {
    wide: { mp4: pagina169Mp4, webm: pagina169Webm, poster: pagina169Poster },
    tall: { mp4: pagina45Mp4, webm: pagina45Webm, poster: pagina45Poster },
  },
  intercalar: {
    wide: { mp4: intercalar169Mp4, webm: intercalar169Webm, poster: intercalar169Poster },
    tall: { mp4: intercalar45Mp4, webm: intercalar45Webm, poster: intercalar45Poster },
  },
  tutorial: {
    wide: { mp4: tutorial169Mp4, webm: tutorial169Webm, poster: tutorial169Poster },
    tall: { mp4: tutorial45Mp4, webm: tutorial45Webm, poster: tutorial45Poster },
  },
} satisfies Record<string, Clip>
