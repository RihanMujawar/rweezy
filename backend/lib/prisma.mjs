import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { env } from "./env.mjs";

const connectionString = env.databaseUrl;
const pool = new pg.Pool({
  connectionString,
  // Set search_path to rweezy schema
  onConnect: async (client) => {
    await client.query('SET search_path = rweezy, public');
  }
});
const adapter = new PrismaPg(pool, { schema: "rweezy" });
const prisma = new PrismaClient({ adapter });

export default prisma;
export { prisma };
