import { Box } from '@mui/material';
import { Blurred } from '@/features/privacy';
import { srOnly } from '@/features/infraCosts/components/costParts';
import { featureUsageStrings as S } from '../strings';


/**
 * Nome da conta sob a flag `usage.tenantName`. `Blurred` só borra a imagem e deixa o nome no DOM; com a flag ligada o
 * nome fica `aria-hidden` e o leitor de tela lê só "Conta <id curto>". Flag desligada: nome normal.
 */
export function BlurredAccountName({ blur, tenantId, name }: { blur: boolean; tenantId: string; name: string }) {
  if (!blur) return <>{name}</>;
  return (
    <>
      <Blurred when inline radius={5}><span aria-hidden="true">{name}</span></Blurred>
      <Box component="span" sx={srOnly}>{S.filters.accountShort(tenantId)}</Box>
    </>
  );
}
