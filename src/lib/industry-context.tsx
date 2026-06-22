import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getIndustryProfile, type IndustryId, type IndustryProfile } from "@/lib/api/industry";

const KEY = "executiveos:industry";

interface Ctx {
  industryId: IndustryId;
  profile: IndustryProfile;
  setIndustryId: (id: IndustryId) => void;
}

const IndustryContext = createContext<Ctx | null>(null);

export function IndustryProvider({ children }: { children: ReactNode }) {
  const [industryId, setIndustryIdState] = useState<IndustryId>("generic");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem(KEY);
    if (v) setIndustryIdState(v as IndustryId);
  }, []);

  const setIndustryId = (id: IndustryId) => {
    setIndustryIdState(id);
    if (typeof window !== "undefined") window.localStorage.setItem(KEY, id);
  };

  return (
    <IndustryContext.Provider value={{ industryId, profile: getIndustryProfile(industryId), setIndustryId }}>
      {children}
    </IndustryContext.Provider>
  );
}

export function useIndustry() {
  const ctx = useContext(IndustryContext);
  if (!ctx) throw new Error("useIndustry must be used within IndustryProvider");
  return ctx;
}
