"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
    Boxes,
    LayoutDashboard,
    Package,
    BookOpen,
    CalendarCheck,
    Wrench,
    Cog,
    BookText,
    ClipboardList,
    ShoppingCart,
    Hourglass,
    ShieldCheck,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    List,
    Database,
    LogOut,
    type LucideIcon,
} from "lucide-react";

const STORAGE_KEY = "sidebar-collapsed";

// Lebar sidebar (px), dipusatkan di sini.
const RAIL_WIDTH = "w-14"; // 56px — saat "pinned" sempit (ikon saja)
const FULL_WIDTH = "w-64"; // 256px — saat "pinned" lebar / lagi di-hover

type SidebarProps = {
    user: {
        name: string;
        role: string;
    };
};

// Sub-item di dalam grup "Sparepart Management" — cuma dirender saat
// sidebar dalam kondisi visual expanded (lihat render grup di bawah).
type NavSubItem = {
    label: string;
    href: string;
    icon: LucideIcon;
};

// Modul yang masih "Segera" (belum ada halamannya). Tetap tampil (ikon +
// label + badge), tapi tidak bisa diklik/navigasi — styling dipudarkan.
type NavDisabledItem = {
    kind: "disabled";
    label: string;
    icon: LucideIcon;
};

// Satu-satunya modul yang sudah aktif sekarang: Sparepart Management,
// beserta 2 sub-halamannya. Modul lain SENGAJA masih "disabled" sampai
// spek masing-masing jelas.
type NavGroupItem = {
    kind: "group";
    label: string;
    icon: LucideIcon;
    href: string; // dipakai sebagai target langsung saat sidebar tidak expanded
    subItems: NavSubItem[];
};

type NavItem = NavDisabledItem | NavGroupItem;

const NAV_ITEMS: NavItem[] = [
    { kind: "disabled", label: "Dashboard", icon: LayoutDashboard },
    {
        kind: "group",
        label: "Sparepart Management",
        icon: Package,
        href: "/sparepart",
        subItems: [
            { label: "Daftar Sparepart", href: "/sparepart", icon: List },
            { label: "Kelola Master Data", href: "/master-data", icon: Database },
        ],
    },
    { kind: "disabled", label: "Logbook", icon: BookOpen },
    { kind: "disabled", label: "Plan Maintenance", icon: CalendarCheck },
    { kind: "disabled", label: "Preventif", icon: Wrench },
    { kind: "disabled", label: "Motor", icon: Cog },
    { kind: "disabled", label: "Manual Book", icon: BookText },
    { kind: "disabled", label: "Work Order", icon: ClipboardList },
    { kind: "disabled", label: "Part Sourcing", icon: ShoppingCart },
    { kind: "disabled", label: "Lifetime", icon: Hourglass },
    { kind: "disabled", label: "Admin Panel", icon: ShieldCheck },
];

// Gabung className kondisional tanpa nambah dependency baru (clsx/cn) —
// project ini belum punya utility semacam itu di src/lib.
function cx(...classes: Array<string | false | null | undefined>): string {
    return classes.filter(Boolean).join(" ");
}

// Tooltip nama menu — cuma dirender saat sidebar TIDAK dalam kondisi
// visual expanded. Parent-nya WAJIB punya class `group relative` supaya
// posisi & hover-nya kerja.
function NavTooltip({ label }: { label: string }) {
    return (
        <span
            role="tooltip"
            className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 font-sans text-xs font-medium text-white opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100"
        >
            {label}
        </span>
    );
}

export function Sidebar({ user }: SidebarProps) {
    const pathname = usePathname();

    // `collapsed` = preferensi TERSIMPAN (di-pin sempit atau tidak),
    // persist ke localStorage lewat tombol toggle. Default TIDAK
    // collapsed selama belum sempat baca localStorage saat mount.
    const [collapsed, setCollapsed] = useState(false);
    const [hydrated, setHydrated] = useState(false);

    // `isHovering` = state sementara (TIDAK disimpan), aktif selama
    // kursor ada di atas sidebar. Ini yang bikin sidebar melebar sendiri
    // saat di-hover tanpa perlu klik, lalu balik menyempit begitu kursor
    // keluar. Sidebar TETAP bagian normal dari flex layout (bukan fixed
    // overlay) — jadi saat melebar/menyempit dia beneran MENGGESER
    // <main>, bukan menimpanya.
    const [isHovering, setIsHovering] = useState(false);

    // Grup "Sparepart Management" default terbuka, supaya begitu sidebar
    // dalam kondisi expanded, kedua sub-halamannya langsung kelihatan.
    const [sparepartOpen, setSparepartOpen] = useState(true);

    useEffect(() => {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored === "true") setCollapsed(true);
        setHydrated(true);
    }, []);

    useEffect(() => {
        if (!hydrated) return;
        window.localStorage.setItem(STORAGE_KEY, String(collapsed));
    }, [collapsed, hydrated]);

    // Kondisi visual yang SEBENARNYA dipakai untuk render (lebar, label,
    // tooltip, dst). Kalau sidebar di-pin lebar (collapsed=false), selalu
    // expanded — hover tidak ngaruh apa-apa karena memang sudah lebar.
    // Kalau di-pin sempit (collapsed=true), expanded cuma aktif SELAMA
    // di-hover, lalu kembali sempit begitu kursor pergi.
    const expanded = !collapsed || isHovering;

    return (
        <aside
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            className={cx(
                "relative flex h-full shrink-0 flex-col border-r border-ink/10 bg-surface transition-all duration-300 ease-in-out",
                expanded ? FULL_WIDTH : RAIL_WIDTH
            )}
        >
            {/* Handle toggle pin — bulat kecil nempel di tepi kanan
                sidebar, posisinya di TENGAH (vertikal) supaya lebih gampang
                dijangkau & lebih intuitif ketimbang ditaruh di header. Ini
                murni toggle preferensi PIN, independen dari hover di atas. */}
            <button
                type="button"
                onClick={() => setCollapsed((prev) => !prev)}
                title={collapsed ? "Pin sidebar tetap lebar" : "Ciutkan sidebar"}
                aria-label={collapsed ? "Pin sidebar tetap lebar" : "Ciutkan sidebar"}
                className="absolute -right-3 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-ink/10 bg-surface text-muted shadow-sm transition-colors hover:bg-app-bg hover:text-ink"
            >
                {collapsed ? (
                    <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                    <ChevronLeft className="h-3.5 w-3.5" />
                )}
            </button>

            {/* Header: cukup logo mark (selalu tampil) + nama app (cuma
                saat expanded). Tombol toggle ada di handle tengah di atas. */}
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-ink/10 px-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Boxes className="h-4 w-4" />
                </div>
                {expanded && (
                    <span className="truncate font-sans text-sm font-semibold text-ink">
                        Sparepart App
                    </span>
                )}
            </div>

            {/* Menu utama. Scrollbar sengaja ditipiskan & dibikin
                transparan-abu netral (bukan warna primary) lewat arbitrary
                variant Tailwind, supaya tidak dominan secara visual — baik
                di Chrome/Edge/Safari (::-webkit-scrollbar) maupun Firefox
                (scrollbar-width/scrollbar-color). */}
            <nav
                className={cx(
                    "flex-1 overflow-y-auto overflow-x-hidden px-2 py-3",
                    "[scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.4)_transparent]",
                    "[&::-webkit-scrollbar]:w-1.5",
                    "[&::-webkit-scrollbar-track]:bg-transparent",
                    "[&::-webkit-scrollbar-thumb]:rounded-full",
                    "[&::-webkit-scrollbar-thumb]:bg-slate-400/40",
                    "hover:[&::-webkit-scrollbar-thumb]:bg-slate-400/60"
                )}
            >
                <ul className="flex flex-col gap-1">
                    {NAV_ITEMS.map((item) => {
                        if (item.kind === "disabled") {
                            const Icon = item.icon;
                            return (
                                <li key={item.label}>
                                    <div
                                        aria-disabled="true"
                                        tabIndex={-1}
                                        className={cx(
                                            "group relative flex cursor-not-allowed select-none items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted/60",
                                            !expanded && "justify-center px-0"
                                        )}
                                    >
                                        <Icon className="h-[18px] w-[18px] shrink-0" />
                                        {expanded && (
                                            <>
                                                <span className="flex-1 truncate font-sans">
                                                    {item.label}
                                                </span>
                                                <span className="shrink-0 rounded-full bg-ink/5 px-2 py-0.5 font-sans text-[10px] font-medium text-muted">
                                                    Segera
                                                </span>
                                            </>
                                        )}
                                        {!expanded && (
                                            <NavTooltip label={`${item.label} · Segera`} />
                                        )}
                                    </div>
                                </li>
                            );
                        }

                        // item.kind === "group" → satu-satunya kasus sekarang:
                        // Sparepart Management.
                        const Icon = item.icon;
                        const isGroupActive = item.subItems.some((sub) =>
                            pathname.startsWith(sub.href)
                        );

                        if (!expanded) {
                            // Tidak expanded: tanpa accordion — ikon utama
                            // langsung jadi link ke item.href (/sparepart).
                            // Akses "Kelola Master Data" baru muncul lagi
                            // setelah sidebar expanded (di-pin lebar atau
                            // di-hover).
                            return (
                                <li key={item.label}>
                                    <Link
                                        href={item.href}
                                        className={cx(
                                            "group relative flex items-center justify-center rounded-md px-0 py-2.5",
                                            isGroupActive
                                                ? "bg-primary/10 text-primary"
                                                : "text-ink hover:bg-app-bg"
                                        )}
                                    >
                                        <Icon className="h-[18px] w-[18px]" />
                                        <NavTooltip label={item.label} />
                                    </Link>
                                </li>
                            );
                        }

                        return (
                            <li key={item.label}>
                                <button
                                    type="button"
                                    onClick={() => setSparepartOpen((prev) => !prev)}
                                    aria-expanded={sparepartOpen}
                                    className={cx(
                                        "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium",
                                        isGroupActive
                                            ? "bg-primary/10 text-primary"
                                            : "text-ink hover:bg-app-bg"
                                    )}
                                >
                                    <Icon className="h-[18px] w-[18px] shrink-0" />
                                    <span className="flex-1 truncate font-sans">
                                        {item.label}
                                    </span>
                                    <ChevronDown
                                        className={cx(
                                            "h-4 w-4 shrink-0 transition-transform duration-200",
                                            sparepartOpen && "rotate-180"
                                        )}
                                    />
                                </button>

                                {sparepartOpen && (
                                    <ul className="ml-[26px] mt-1 flex flex-col gap-0.5 border-l border-ink/10 pl-3">
                                        {item.subItems.map((sub) => {
                                            const SubIcon = sub.icon;
                                            const isSubActive = pathname.startsWith(sub.href);
                                            return (
                                                <li key={sub.href}>
                                                    <Link
                                                        href={sub.href}
                                                        className={cx(
                                                            "flex items-center gap-2 rounded-md px-2 py-2 font-sans text-sm",
                                                            isSubActive
                                                                ? "bg-primary/10 font-medium text-primary"
                                                                : "text-ink/80 hover:bg-app-bg hover:text-ink"
                                                        )}
                                                    >
                                                        <SubIcon className="h-4 w-4 shrink-0" />
                                                        <span className="truncate">{sub.label}</span>
                                                    </Link>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </nav>

            {/* Bagian bawah: identitas user + logout — selalu terlihat baik
                expanded maupun tidak. */}
            <div className="shrink-0 border-t border-ink/10 p-2">
                <div
                    className={cx(
                        "group relative flex items-center gap-3 rounded-md px-2 py-2",
                        !expanded && "justify-center px-0"
                    )}
                >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-sans text-sm font-semibold text-primary">
                        {user.name.charAt(0).toUpperCase() || "?"}
                    </div>
                    {expanded && (
                        <div className="min-w-0 flex-1">
                            <p className="truncate font-sans text-sm font-medium text-ink">
                                {user.name}
                            </p>
                            <p className="truncate font-sans text-xs text-muted">
                                {user.role}
                            </p>
                        </div>
                    )}
                    {!expanded && <NavTooltip label={`${user.name} · ${user.role}`} />}
                </div>

                <button
                    type="button"
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className={cx(
                        "group relative mt-1 flex w-full items-center gap-3 rounded-md px-2 py-2 font-sans text-sm text-muted hover:bg-status-danger/10 hover:text-status-danger",
                        !expanded && "justify-center px-0"
                    )}
                >
                    <LogOut className="h-4 w-4 shrink-0" />
                    {expanded && <span>Logout</span>}
                    {!expanded && <NavTooltip label="Logout" />}
                </button>
            </div>
        </aside>
    );
}