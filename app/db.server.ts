import { PrismaClient } from "@prisma/client";

const appEnv = process.env.APP_ENV || "development";
if (appEnv !== "production") {
  process.env.DATABASE_URL = process.env.DEV_DATABASE_URL || "file:./dev.sqlite";
}

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;
