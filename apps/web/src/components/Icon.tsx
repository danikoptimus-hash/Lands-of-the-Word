/** Набор иконок (контурные, 24×24). Имя → path. Используем вместо слов там, где смысл ясен: корзина, ссылка, плюс… */
const P: Record<string, string> = {
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  scroll: "M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4M8 21a2 2 0 0 1-2-2M6 5h12a2 2 0 0 1 2 2v10M10 9h6m-6 4h6",
  check: "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.5a7.6 7.6 0 0 0-2 1.2l-2.5-1-2 3.5 2.1 1.6a7.4 7.4 0 0 0 0 2.4L2.6 14.8l2 3.5 2.5-1a7.6 7.6 0 0 0 2 1.2l.4 2.5h5l.4-2.5a7.6 7.6 0 0 0 2-1.2l2.5 1 2-3.5-2.1-1.6c.07-.4.1-.8.1-1.2Z",
  play: "M6 4l14 8-14 8V4Z",
  refresh: "M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  plus: "M12 5v14M5 12h14",
  trash: "M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14",
  x: "M18 6 6 18M6 6l12 12",
  chevron: "m9 18 6-6-6-6",
  back: "m15 18-6-6 6-6",
  crown: "m2 8 5 4 5-8 5 8 5-4-2 12H4L2 8Z",
  wave: "M2 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0M2 18c2-3 4-3 6 0s4 3 6 0 4-3 6 0",
  flag: "M4 22V4m0 0h12l-2 4 2 4H4",
  home: "m3 11 9-8 9 8v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V11Z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m12-14a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Zm11 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  star: "m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z",
  expand: "M15 3h6v6M9 21H3v-15M21 3l-7 7M3 21l7-7",
  city: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4M9 10h.01M15 10h.01M9 14h.01M15 14h.01",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-14v6l4 2",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm18 2-10 7L2 6",
  alert: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  handshake: "m11 17 2 2a1 1 0 1 0 3-3m-3-3 2 2a1 1 0 1 0 3-3m-5-3 4 4M2 9l4-4 5 1 4-1 4 4-3 3-5-3-4 3-5-3Zm5 9-3-3",
  copy: "M8 8h12v12H8zM16 8V4H4v12h4",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z",
  send: "m22 2-7 20-4-9-9-4 20-7Z",
  telescope: "m4 14 12-7 3 5-12 7-3-5Zm12-7 3-2 3 5-3 2M9 17l3 5m-6-2 3-3",
};
export function Icon({ name, size, className, title }: { name: keyof typeof P | string; size?: number; className?: string; title?: string }) {
  const d = P[name] ?? P.list!;
  return (
    <svg className={"i" + (className ? " " + className : "")} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  );
}
