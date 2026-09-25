import type { MediaCapabilities } from '../../domain/contracts/MediaCapabilities';
import {
  buildMediaUploadConfig,
  type MediaUploadConfig,
  type MediaUploadSettings,
} from '../../domain/services/mediaUploadConfig';

/**
 * Config público de upload (`GET /media/uploads/config`): limites para o painel avisar
 * antes de subir e capacidades detectadas no boot para esconder o que o servidor não faz.
 */
export class GetMediaUploadConfigUseCase {
  constructor(
    private readonly settings: MediaUploadSettings,
    private readonly capabilities: MediaCapabilities,
  ) {}

  execute(): MediaUploadConfig {
    return buildMediaUploadConfig(this.settings, this.capabilities);
  }
}
