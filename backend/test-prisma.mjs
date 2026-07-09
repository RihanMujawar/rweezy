import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/rweezy";
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

prisma.user.findUnique({ where: { id: 'test' } })
  .then(() => console.log('Query works!'))
  .catch(e => console.error('Error:', e.message))
  .finally(() => prisma.$disconnect().then(() => pool.end()));