'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { spacePath } from '@/lib/public-address';

const AddressContext = createContext(false);
export function PublicAddressProvider({
  customDomain,
  children,
}: {
  customDomain: boolean;
  children: ReactNode;
}) {
  return <AddressContext.Provider value={customDomain}>{children}</AddressContext.Provider>;
}
export function useSpacePath(handle: string) {
  const custom = useContext(AddressContext);
  return (slug?: string) => spacePath(handle, custom, slug);
}
