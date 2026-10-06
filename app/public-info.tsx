import Link from "next/link";
import type { ReactNode } from "react";
import { publicSite } from "@/lib/public-site";
import styles from "./public-info.module.css";

const pages = [
  { href: "/about", label: "Giới thiệu" },
  { href: "/privacy", label: "Quyền riêng tư" },
  { href: "/terms", label: "Điều khoản" },
];

export default function PublicInfo({ currentPath, title, description, children }: {
  currentPath: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/about" className={styles.brand} aria-label="708 La Thành — Giới thiệu ứng dụng">
          <span className="brand-badge" aria-hidden="true">708</span><span>La Thành</span>
        </Link>
        <Link href="/login" className={styles.signIn}>Đăng nhập</Link>
      </header>
      <main className={styles.main}>
        <nav className={styles.navigation} aria-label="Thông tin ứng dụng">
          {pages.map((page) => <Link key={page.href} href={page.href} aria-current={currentPath === page.href ? "page" : undefined}>{page.label}</Link>)}
        </nav>
        <article className={styles.article}>
          <header className={styles.articleHeader}>
            <h1>{title}</h1>
            <p>{description}</p>
            {currentPath !== "/about" && <p className={styles.updated}>Cập nhật ngày <time dateTime={publicSite.updatedAt}>{publicSite.updatedLabel}</time></p>}
          </header>
          <div className={styles.content}>{children}</div>
        </article>
      </main>
      <footer className={styles.footer}>
        <span>{publicSite.name} · Hỗ trợ và yêu cầu về dữ liệu</span>
        <a href={`mailto:${publicSite.supportEmail}`}>{publicSite.supportEmail}</a>
      </footer>
    </div>
  );
}
