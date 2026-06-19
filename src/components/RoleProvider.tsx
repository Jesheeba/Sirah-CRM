"use client";

import { createContext, useContext } from "react";
import type { Role } from "@/lib/auth";

const RoleContext = createContext<Role>("Sales Rep");

export function RoleProvider({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export const useRole = () => useContext(RoleContext);
