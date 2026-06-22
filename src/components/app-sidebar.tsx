import { Link, useRouterState } from "@tanstack/react-router";
import { useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  LayoutDashboard,
  MessageSquareText,
  ScrollText,
  Briefcase,
  SlidersHorizontal,
  Users,
  ListChecks,
  FileBarChart,
  Brain,
  Signal,
  GitBranch,
  Activity,
  Compass,
  Trash2,
  Database,
  Upload,
  Gauge,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listDatasets, deleteDataset, createDataset, getDatasetRows, importDatasetFromUrl } from "@/lib/api/datasets";
import { computeKpis, forecastRevenue } from "@/lib/api/analysis";
import { saveForecast, saveKpiSummary } from "@/lib/api/persistence";
import type { DatasetRow } from "@/lib/api/types";
import { useActiveDataset } from "@/lib/dataset-context";
import { useIndustry } from "@/lib/industry-context";
import { INDUSTRY_PROFILES, type IndustryId } from "@/lib/api/industry";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function parseFile(file: File): Promise<DatasetRow[]> {
  return new Promise((resolve, reject) => {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".csv") || file.type === "text/csv") {
      Papa.parse<DatasetRow>(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (res) => resolve((res.data ?? []).filter((r) => r && Object.keys(r).length > 0)),
        error: reject,
      });
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result, { type: "binary" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json<DatasetRow>(sheet, { defval: null }));
      } catch (e) { reject(e); }
    };
    reader.readAsBinaryString(file);
  });
}

// Dashboard sub-sections, each lives on its own page.
const DASHBOARD_SUBSECTIONS = [
  { title: "Strategic Signals", url: "/signals", icon: Signal },
  { title: "Decisions Requiring Attention", url: "/decisions", icon: GitBranch },
  { title: "Executive Team Activity", url: "/team", icon: Activity },
] as const;

// Every feature retained, grouped by executive intent for hierarchy.
const groups = [
  {
    label: "Intelligence",
    items: [
      { title: "AI Chat", url: "/chat", icon: MessageSquareText },
      { title: "AI Boardroom", url: "/boardroom", icon: Users },
      { title: "Consultant Report", url: "/consultant", icon: Briefcase },
      { title: "CEO Brief", url: "/ceo-brief", icon: ScrollText },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Mission Control", url: "/simulator", icon: SlidersHorizontal },
      { title: "Execution Center", url: "/action-plans", icon: ListChecks },
    ],
  },
  {
    label: "Records",
    items: [
      { title: "Executive Memory", url: "/memory", icon: Brain },
      { title: "Reports", url: "/reports", icon: FileBarChart },
    ],
  },
  {
    label: "Evaluation",
    items: [
      { title: "Model Accuracy", url: "/accuracy", icon: Gauge },
    ],
  },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const qc = useQueryClient();
  const { activeDatasetId, setActiveDatasetId } = useActiveDataset();
  const { industryId, setIndustryId } = useIndustry();
  const { data: datasets = [] } = useQuery({ queryKey: ["datasets"], queryFn: listDatasets });
  const onDashboard = pathname === "/";
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleDelete(id: string) {
    await deleteDataset(id);
    if (activeDatasetId === id) setActiveDatasetId(null);
    await qc.invalidateQueries({ queryKey: ["datasets"] });
    toast.success("Dataset removed");
  }

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const parsed = await parseFile(file);
      if (!parsed.length) throw new Error("No rows detected in file");
      const ds = await createDataset({
        name: file.name.replace(/\.(csv|xlsx?|xls)$/i, ""),
        source_filename: file.name,
        rows: parsed,
      });
      const freshRows = await getDatasetRows(ds.id);
      const summary = computeKpis(freshRows, ds.schema);
      await saveKpiSummary(ds.id, summary);
      await saveForecast(ds.id, forecastRevenue(summary.series, 6));
      setActiveDatasetId(ds.id);
      await qc.invalidateQueries({ queryKey: ["datasets"] });
      toast.success(`Uploaded ${ds.name} (${parsed.length.toLocaleString()} rows)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleImportUrl() {
    const url = typeof window !== "undefined" ? window.prompt("Paste a public CSV link or a Google Sheet URL (published to the web):") : null;
    if (!url || !url.trim()) return;
    setUploading(true);
    try {
      const ds = await importDatasetFromUrl({ url: url.trim() });
      const freshRows = await getDatasetRows(ds.id);
      const summary = computeKpis(freshRows, ds.schema);
      await saveKpiSummary(ds.id, summary);
      await saveForecast(ds.id, forecastRevenue(summary.series, 6));
      setActiveDatasetId(ds.id);
      await qc.invalidateQueries({ queryKey: ["datasets"] });
      toast.success(`Imported ${ds.name} (${ds.row_count.toLocaleString()} rows)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 pt-6 pb-5">
        <Link to="/" className="flex items-center gap-3">
          <div className="grid place-items-center h-10 w-10 rounded-xl border border-[var(--color-rose)]/45 bg-[var(--color-rose)]/12 font-display text-2xl leading-none text-[var(--color-rose)]">
            E
          </div>
          <div className="flex flex-col leading-none group-data-[collapsible=icon]:hidden">
            <span className="font-display text-xl tracking-tight text-sidebar-accent-foreground">ExecutiveOS</span>
            <span className="text-[10px] uppercase tracking-[0.3em] text-sidebar-foreground/60 mt-1">
              Chief of Staff
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-1.5 no-scrollbar scroll-smooth">
        {/* Dashboard with jump-to sub-sections */}
        <SidebarGroup className="py-1">
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.24em] text-sidebar-foreground/55 px-3">
            Briefing
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={onDashboard}
                  tooltip="Dashboard"
                  className={cn(
                    "h-10 rounded-lg text-sidebar-foreground/85 transition-colors hover:text-sidebar-accent-foreground",
                    onDashboard && "nav-active text-sidebar-accent-foreground",
                  )}
                >
                  <Link to="/" className="flex items-center gap-3">
                    <LayoutDashboard className="h-4 w-4" />
                    <span className="text-[13px] tracking-tight">Dashboard</span>
                  </Link>
                </SidebarMenuButton>
                <SidebarMenuSub className="border-sidebar-border mr-0 pr-0">
                  {DASHBOARD_SUBSECTIONS.map((s) => (
                    <SidebarMenuSubItem key={s.url}>
                      <SidebarMenuSubButton
                        asChild
                        isActive={pathname.startsWith(s.url)}
                        className="text-sidebar-foreground/70 hover:text-sidebar-accent-foreground data-[active=true]:bg-[var(--color-rose)]/15 data-[active=true]:text-sidebar-accent-foreground"
                      >
                        <Link to={s.url} className="flex items-center gap-2">
                          <s.icon className="h-3.5 w-3.5" />
                          <span className="text-[12px] tracking-tight">{s.title}</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith("/guide")}
                  tooltip="Guide"
                  className={cn(
                    "h-10 rounded-lg text-sidebar-foreground/85 transition-colors hover:text-sidebar-accent-foreground",
                    pathname.startsWith("/guide") && "nav-active text-sidebar-accent-foreground",
                  )}
                >
                  <Link to="/guide" className="flex items-center gap-3">
                    <Compass className="h-4 w-4" />
                    <span className="text-[13px] tracking-tight">Guide</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {groups.map((group) => (
          <SidebarGroup key={group.label} className="py-1">
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.24em] text-sidebar-foreground/55 px-3">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {group.items.map((item) => {
                  const isActive = pathname.startsWith(item.url);
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.title}
                        className={cn(
                          "h-10 rounded-lg text-sidebar-foreground/85 transition-colors hover:text-sidebar-accent-foreground",
                          isActive && "nav-active text-sidebar-accent-foreground",
                        )}
                      >
                        <Link to={item.url} className="flex items-center gap-3">
                          <item.icon className="h-4 w-4" />
                          <span className="text-[13px] tracking-tight">{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* Prominent dataset management, bottom left */}
      <SidebarFooter className="px-3 pb-5 group-data-[collapsible=icon]:hidden">
        {/* Industry calibration — tunes thresholds and AI framing to the business type */}
        <div className="rounded-xl border border-sidebar-border bg-white/5 p-3 mb-2">
          <label className="block text-[11px] uppercase tracking-[0.2em] text-sidebar-accent-foreground font-medium mb-2 px-1">
            Industry
          </label>
          <select
            value={industryId}
            onChange={(e) => setIndustryId(e.target.value as IndustryId)}
            className="w-full h-9 rounded-lg bg-white/5 border border-sidebar-border text-[12px] text-sidebar-foreground px-2 outline-none focus:border-[var(--color-rose)]/50"
          >
            {Object.values(INDUSTRY_PROFILES).map((p) => (
              <option key={p.id} value={p.id} className="bg-background text-foreground">{p.label}</option>
            ))}
          </select>
          <p className="text-[10px] text-sidebar-foreground/50 mt-1.5 px-1 leading-relaxed">
            Calibrates margin/growth thresholds and AI framing to your sector.
          </p>
        </div>

        <div className="rounded-xl border border-sidebar-border bg-white/5 p-3">
          <div className="flex items-center gap-2 mb-2.5 px-1">
            <Database className="h-3.5 w-3.5 text-[var(--color-rose)]" />
            <p className="text-[11px] uppercase tracking-[0.2em] text-sidebar-accent-foreground font-medium">Datasets</p>
            <span className="ml-auto text-[11px] text-sidebar-foreground/60 tabular">{datasets.length}</span>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-2 h-9 rounded-lg bg-[var(--color-rose)]/20 border border-[var(--color-rose)]/40 text-sidebar-accent-foreground text-[12px] font-medium hover:bg-[var(--color-rose)]/30 transition-colors disabled:opacity-50 mb-1.5"
          >
            <Upload className="h-3.5 w-3.5" />
            {uploading ? "Working…" : "Upload dataset"}
          </button>
          <button
            onClick={handleImportUrl}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-2 h-8 rounded-lg border border-sidebar-border text-sidebar-foreground/80 text-[11px] font-medium hover:text-sidebar-foreground hover:border-sidebar-foreground/30 transition-colors disabled:opacity-50 mb-2.5"
          >
            <Database className="h-3 w-3" />
            Import from URL / Google Sheet
          </button>

          {datasets.length === 0 ? (
            <p className="text-[12px] text-sidebar-foreground/55 px-1 py-2 leading-relaxed">
              No datasets yet. Upload one to begin.
            </p>
          ) : (
            <ul className="space-y-1 max-h-52 overflow-y-auto scrollbar-slim">
              {datasets.map((d) => {
                const active = d.id === activeDatasetId;
                return (
                  <li
                    key={d.id}
                    className={cn(
                      "group/ds flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-colors",
                      active ? "bg-[var(--color-rose)]/18 text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-white/8",
                    )}
                    onClick={() => setActiveDatasetId(d.id)}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", active ? "bg-[var(--color-rose)]" : "bg-sidebar-foreground/30")} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium truncate leading-tight">{d.name}</p>
                      <p className="text-[10px] text-sidebar-foreground/55 tabular">{d.row_count.toLocaleString()} rows</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleDelete(d.id); }}
                      className="shrink-0 grid place-items-center h-7 w-7 rounded-md text-sidebar-foreground/55 hover:text-[#ff8a8a] hover:bg-white/10 transition-colors"
                      aria-label={`Delete ${d.name}`}
                      title="Delete dataset"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
