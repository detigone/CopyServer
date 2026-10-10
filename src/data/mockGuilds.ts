export interface MockGuild {
  id: string;
  name: string;
  icon?: string;
  initials: string;
  color: string;
  memberCount: number;
  rolesCount: number;
  channelsCount: number;
  emojisCount: number;
}

export const INITIAL_GUILDS: MockGuild[] = [
  {
    id: "109876543210987654",
    name: "CYBERPUNK // COMMUNITY",
    initials: "CC",
    color: "#5865f2",
    memberCount: 4820,
    rolesCount: 24,
    channelsCount: 38,
    emojisCount: 50,
  },
  {
    id: "987654321098765432",
    name: "DevHub Developers Guild",
    initials: "DH",
    color: "#23a55a",
    memberCount: 1420,
    rolesCount: 18,
    channelsCount: 26,
    emojisCount: 32,
  },
  {
    id: "876543210987654321",
    name: "Gaming Squad & Chill",
    initials: "GS",
    color: "#f0b232",
    memberCount: 890,
    rolesCount: 14,
    channelsCount: 19,
    emojisCount: 45,
  },
  {
    id: "765432109876543210",
    name: "Новый тестовый сервер (Пустой)",
    initials: "НТ",
    color: "#f23f43",
    memberCount: 3,
    rolesCount: 1,
    channelsCount: 2,
    emojisCount: 0,
  },
];
