'use client';
import { useMemo } from 'react';
import { PageLayoutEditor } from './page-layout-editor';
import { useFiles } from '../components/files/use-files';
import { orderColumnFiles } from '@/lib/mobile-layout';
import type { ActiveWorkspace } from './use-workspace';
import type { RegisterNavigationGuard } from '@/lib/navigation-guard';
import { useTranslation } from '../components/language-provider';

export default function PageLayout({
  workspace,
  registerGuard,
}: {
  workspace: ActiveWorkspace;
  registerGuard: RegisterNavigationGuard;
}) {
  const { t } = useTranslation();
  const files = useFiles(workspace.profile.id);
  const value = useMemo(
    () =>
      workspace.profile.mobileLayout?.fileIds ??
      orderColumnFiles(
        workspace.profile,
        files.files.filter((file) => file.published),
      ).map((file) => file.id),
    [workspace.profile, files.files],
  );
  if (files.loading) return <p role="status">{t('Loading…')}</p>;
  if (files.error) return <p role="alert">{t(files.error)}</p>;
  return (
    <PageLayoutEditor
      files={files.files}
      value={value}
      disabled={workspace.busy}
      registerGuard={registerGuard}
      onSave={(mobileLayout) =>
        workspace.save({
          action: 'update_profile',
          mobileLayout: { ...mobileLayout, screens: 'all' },
        })
      }
      onOpenFiles={() => void workspace.selectSection('files')}
    />
  );
}
