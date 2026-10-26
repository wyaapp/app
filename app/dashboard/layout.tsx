import type { ReactNode } from 'react';
import './desktop.css';

export const metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return children;
}
