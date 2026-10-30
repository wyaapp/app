export type NavigationGuard = () => Promise<boolean>;
export type RegisterNavigationGuard = (id: string, guard: NavigationGuard) => () => void;
