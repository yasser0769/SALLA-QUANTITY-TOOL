import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "أداة تحديث أسعار وكميات سلة",
  description: "معالجة ملفات المورد وسلة وإنتاج ملفات تحديث الأسعار والكميات الجاهزة للرفع.",
  openGraph: {
    title: "أداة تحديث أسعار وكميات سلة",
    description: "ملفات جاهزة للرفع خلال دقائق",
    locale: "ar_SA",
    type: "website",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "أداة تحديث أسعار وكميات سلة",
    description: "ملفات جاهزة للرفع خلال دقائق",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
