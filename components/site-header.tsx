import Link from "next/link";

const links = [
  { href: "/", label: "Today" },
  { href: "/history", label: "History" },
  { href: "/about", label: "About" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-white/10">
      <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          NHL Goalscorer Model
        </Link>
        <nav className="flex gap-4 text-sm text-muted">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
