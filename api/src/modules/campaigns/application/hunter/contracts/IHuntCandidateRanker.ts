import type { HuntCandidate, HuntScore } from '../../../domain/hunter/HuntCandidate';
export interface RankableHuntCandidate { candidate: HuntCandidate; score: HuntScore }
export interface HuntRankingInput { tenantId: string; candidates: RankableHuntCandidate[]; topN: number }
export interface HuntRankingPick { productId: string; reason: string }
/** null = IA indisponível/saída inválida → chamador usa o ranking determinístico (aiFallback). */
export interface IHuntCandidateRanker { rank(input: HuntRankingInput): Promise<HuntRankingPick[] | null> }
