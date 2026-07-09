import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/rweezy";
const pool = new pg.Pool({ 
  connectionString,
  // Set search_path to rweezy schema
  onConnect: async (client) => {
    await client.query('SET search_path = rweezy');
  }
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export default prisma;
export { prisma };
