/**
 * Acervo de videoaulas (docs/tutoriais.md). Dado estático: só ids e vídeo; todo texto fica em
 * `strings.ts` (chave = `id`). Aula sem `youtubeId` aparece como "Em breve" e não conta no progresso.
 * Para publicar uma aula nova, preencha o `youtubeId` — nada mais muda.
 */
export type LessonGroup = 'start' | 'credentials' | 'resources';

export interface Lesson {
  /** Estável: é a chave do progresso salvo no navegador. Nunca renomear. */
  id: string;
  /** Rótulo da posição na trilha ("1", "5.1"). */
  number: string;
  group: LessonGroup;
  youtubeId: string | null;
}

export const LESSON_GROUPS: readonly LessonGroup[] = ['start', 'credentials', 'resources'];

export const LESSONS: readonly Lesson[] = [
  { id: 'connect-sessions', number: '1', group: 'start', youtubeId: 'UH5YoboW5LY' },
  { id: 'install-desktop', number: '2', group: 'start', youtubeId: 'RCdrERJEFk4' },
  { id: 'install-android', number: '3', group: 'start', youtubeId: 'TSjZUXrn6fI' },
  { id: 'install-ios', number: '4', group: 'start', youtubeId: 'H8BqUI3I7mU' },
  { id: 'credential-mercado-livre', number: '5.1', group: 'credentials', youtubeId: 'JFqfMpWOGeg' },
  { id: 'credential-shein', number: '5.2', group: 'credentials', youtubeId: 'bzeijQUmlgI' },
  { id: 'credential-shopee', number: '5.3', group: 'credentials', youtubeId: 'ex4ASPYH8oQ' },
  { id: 'credential-amazon', number: '5.4', group: 'credentials', youtubeId: 'wnZErO6Xk8s' },
  { id: 'monitoring', number: '6', group: 'resources', youtubeId: 'mpN-4lCYxPU' },
  { id: 'offer-generator', number: '7', group: 'resources', youtubeId: null },
  { id: 'link-manager', number: '8', group: 'resources', youtubeId: 'hPhCZ7HbuNI' },
  { id: 'storefront', number: '9', group: 'resources', youtubeId: null },
  { id: 'offer-story', number: '10', group: 'resources', youtubeId: null },
];

export const isPlayable = (lesson: Lesson): boolean => lesson.youtubeId !== null;

export const thumbnailUrl = (youtubeId: string): string => `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
export const watchUrl = (youtubeId: string): string => `https://youtu.be/${youtubeId}`;
