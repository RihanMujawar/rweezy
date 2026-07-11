import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connectionString = "postgresql://rweezy:rweezy485019@localhost:5432/rweezy?schema=rweezy";
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool, { schema: "rweezy" });
const prisma = new PrismaClient({ adapter });

const user = await prisma.user.findFirst();
console.log("User found:", user?.email);
await prisma.$disconnect();
