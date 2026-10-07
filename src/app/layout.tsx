import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Licycolba",
  description: "Sistema de gestión comercial — Grupo Colba",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable}`}
      style={{ height: "100%" }}
      suppressHydrationWarning
    >
      <head>
        {/* Versión | id del commit desplegado, visible en la consola del navegador */}
        <script dangerouslySetInnerHTML={{__html:`console.log(${JSON.stringify(`Licycolba | v${process.env.NEXT_PUBLIC_APP_VERSION} | ${process.env.NEXT_PUBLIC_APP_COMMIT}`)});`}} />
        {/* Aplica tema antes de renderizar para evitar flash */}
        <script dangerouslySetInnerHTML={{__html:`
          (function(){
            var t=localStorage.getItem('licy_theme')||'pink';
            document.documentElement.setAttribute('data-theme',t);
          })();
          (function(){
            document.addEventListener('contextmenu',function(e){
              var el=e.target;
              if(el.tagName==='IMG'||el.closest('img')){e.preventDefault();return false;}
            });
            document.addEventListener('dragstart',function(e){
              if(e.target.tagName==='IMG'){e.preventDefault();return false;}
            });
          })();
        `}} />
      </head>
      <body style={{ height: "100%", overflow: "hidden" }}>
        {children}
      </body>
    </html>
  );
}