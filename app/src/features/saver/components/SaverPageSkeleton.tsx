import type { LucideIcon } from 'lucide-react';
import { Box } from '@mui/material';
import { AppIcon, EmptyState, PageHeader } from '@/components';
import { saverStrings as s } from '../strings';

interface Props {
  title: string;
  subtitle: string;
  icon: LucideIcon;
}

/** Esqueleto das telas do Saver até cada uma ser preenchida (rota e menu já valem). */
export function SaverPageSkeleton({ title, subtitle, icon }: Props) {
  return (
    <Box>
      <PageHeader title={title} subtitle={subtitle} />
      <EmptyState icon={<AppIcon icon={icon} size="lg" />} title={title} description={s.pages.comingSoon} sx={{ mt: 4 }} />
    </Box>
  );
}
