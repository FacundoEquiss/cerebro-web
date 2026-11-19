import type { Metadata } from "next";
import { Clock, Mail, MapPin, MessageCircle } from "lucide-react";
import { brand } from "@/config/brand";
import { fill, paths, t, tr } from "@/i18n";
import { pageMetadata } from "@/lib/seo";
import styles from "./contact.module.css";

export function generateMetadata(): Metadata {
  return pageMetadata({ title: t.contact.title, description: fill(t.contact.metaDescription, { brand: brand.name }), path: paths.contact() });
}

export default function ContactPage() {
  const { contact } = brand;
  const social = Object.entries(brand.social).filter((e): e is [string, string] => Boolean(e[1]));
  return (
    <div className={`container page ${styles.page}`}>
      <h1>{t.contact.title}</h1>
      <p className={`muted ${styles.intro}`}>{t.contact.intro}</p>
      <ul className={styles.cards}>
        {contact.whatsapp ? (
          <li className="card">
            <MessageCircle aria-hidden />
            <h2>{t.contact.whatsapp}</h2>
            {contact.phoneDisplay ? <p className="muted">{contact.phoneDisplay}</p> : null}
            <a className="btn" href={`https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(t.contact.whatsappHello)}`} rel="noopener noreferrer" target="_blank">
              {t.contact.whatsappCta}
            </a>
          </li>
        ) : null}
        <li className="card">
          <Mail aria-hidden />
          <h2>{t.contact.email}</h2>
          <a className="link" href={`mailto:${contact.email}`}>{contact.email}</a>
        </li>
        {contact.hours ? (
          <li className="card">
            <Clock aria-hidden />
            <h2>{t.contact.hours}</h2>
            <p className="muted">{tr(contact.hours)}</p>
          </li>
        ) : null}
        {contact.address ? (
          <li className="card">
            <MapPin aria-hidden />
            <h2>{t.contact.address}</h2>
            <p className="muted">{contact.address}</p>
          </li>
        ) : null}
      </ul>
      {social.length > 0 ? (
        <p className={styles.social}>
          {t.contact.social}:{" "}
          {social.map(([name, url]) => (
            <a key={name} href={url} className="link" rel="noopener noreferrer" target="_blank">{name}</a>
          ))}
        </p>
      ) : null}
    </div>
  );
}
