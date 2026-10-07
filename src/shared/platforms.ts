// Display names and "why you book yourself" notes for each booking system. Shared by every dashboard page.

export const PLATFORM_NAME: Record<string, string> = {
  formitable: 'Formitable',
  tebi: 'Tebi',
  zenchef: 'Zenchef',
  sevenrooms: 'SevenRooms',
  guestplan: 'Guestplan',
  tablecheck: 'TableCheck',
  thefork: 'TheFork',
  demo: 'Demo',
  other: 'Unknown system',
};

export const platformName = (id: string) => PLATFORM_NAME[id] ?? id;

/** Why Seated alerts but does not book on this system. */
export const NO_AUTOBOOK_WHY: Record<string, string> = {
  tebi: "Tebi protects its booking form with a captcha, so you book yourself. Seated alerts you and opens the restaurant's Tebi page.",
  sevenrooms: 'This restaurant takes bookings through SevenRooms. Seated only reads SevenRooms: it alerts you and opens the booking page on the right date and time.',
  guestplan: "This restaurant takes bookings through Guestplan. Seated only reads Guestplan: it alerts you with the date and time and opens the restaurant's booking page.",
  zenchef: 'This restaurant takes bookings through Zenchef. Seated only reads Zenchef: it alerts you and opens the booking page on the right date.',
};
