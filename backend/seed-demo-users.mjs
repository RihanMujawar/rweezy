import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcryptjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env manually to ensure DATABASE_URL is available
const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  const envContent = await fs.readFile(path.join(__dirname, "../.env"), "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^\s*([^#\s=]+)\s*=\s*(.*)$/);
    if (match) {
      const key = match[1];
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
} catch (err) {
  // Ignore if .env load fails
}

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/rweezy";
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const password = process.env.DEMO_PASSWORD || "Demo123456";
const passwordHash = await bcrypt.hash(password, 10);

const demoUsers = [
  { email: "demo.customer@rweezy.test", fullName: "Demo Customer", phone: "+919000000001", role: "customer" },
  { email: "demo.rider@rweezy.test", fullName: "Demo Rider", phone: "+919000000002", role: "rider" },
  {
    email: "demo.delivery@rweezy.test",
    fullName: "Demo Delivery Partner",
    phone: "+919000000003",
    role: "delivery_boy",
  },
  {
    email: "demo.restaurant@rweezy.test",
    fullName: "Demo Restaurant Manager",
    phone: "+919000000004",
    role: "hotel_manager",
  },
  {
    email: "demo.grocery@rweezy.test",
    fullName: "Demo Grocery Manager",
    phone: "+919000000005",
    role: "grocery_manager",
  },
  { email: "demo.admin@rweezy.test", fullName: "Demo Admin", phone: "+919000000006", role: "admin" },
];

async function main() {
  console.log("Seeding demo users...");
  for (const demoUser of demoUsers) {
    // Upsert User
    const user = await prisma.user.upsert({
      where: { email: demoUser.email },
      update: {
        phone: demoUser.phone,
        password_hash: passwordHash,
      },
      create: {
        email: demoUser.email,
        phone: demoUser.phone,
        password_hash: passwordHash,
      },
    });

    // Upsert Profile
    await prisma.profile.upsert({
      where: { id: user.id },
      update: {
        full_name: demoUser.fullName,
        phone: demoUser.phone,
      },
      create: {
        id: user.id,
        full_name: demoUser.fullName,
        phone: demoUser.phone,
      },
    });

    // Upsert UserRole
    await prisma.userRole.upsert({
      where: {
        user_id_role: {
          user_id: user.id,
          role: demoUser.role,
        },
      },
      update: {},
      create: {
        user_id: user.id,
        role: demoUser.role,
      },
    });

    console.log(`User: ${demoUser.email} | Password: ${password} | Role: ${demoUser.role}`);
  }
  console.log("Database seeded successfully!");
}

main()
  .catch((e) => {
    console.error("Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
