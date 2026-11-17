-- Links de redirecionamento dos checkouts do Saver (vitrine /saver/plans → /redirect/saver-<tier>-<mensal|anual>).
-- Só acrescenta: slug já existente fica como está (ON CONFLICT DO NOTHING), inclusive destino, contagem e status.
-- Destino editável depois em Plataforma → Links de redirecionamento (docs/redirect-links.md).
INSERT INTO "redirect_links" ("id", "slug", "urlA", "urlB", "percentA", "isActive", "hitsA", "hitsB", "note", "createdAt", "updatedAt")
VALUES
  ('rl_saver_lite_mensal', 'saver-lite-mensal', 'https://pay.cakto.com.br/3be4er9_1335615', NULL, 100, true, 0, 0, 'Checkout CopySync Saver LITE Mensal (vitrine /saver/plans)', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rl_saver_lite_anual',  'saver-lite-anual',  'https://pay.cakto.com.br/3et829p_1335602', NULL, 100, true, 0, 0, 'Checkout CopySync Saver LITE Anual (vitrine /saver/plans)',  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rl_saver_pro_mensal',  'saver-pro-mensal',  'https://pay.cakto.com.br/7qwc4m8_1335625', NULL, 100, true, 0, 0, 'Checkout CopySync Saver PRO Mensal (vitrine /saver/plans)',  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rl_saver_pro_anual',   'saver-pro-anual',   'https://pay.cakto.com.br/33aqmhg_1335620', NULL, 100, true, 0, 0, 'Checkout CopySync Saver PRO Anual (vitrine /saver/plans)',   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rl_saver_max_mensal',  'saver-max-mensal',  'https://pay.cakto.com.br/3c9393m_1335638', NULL, 100, true, 0, 0, 'Checkout CopySync Saver MAX Mensal (vitrine /saver/plans)',  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rl_saver_max_anual',   'saver-max-anual',   'https://pay.cakto.com.br/82vzifo_1335633', NULL, 100, true, 0, 0, 'Checkout CopySync Saver MAX Anual (vitrine /saver/plans)',   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
