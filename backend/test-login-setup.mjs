const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const pg = require("pg");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");

dotenv.config({ path: "./.env" });

const connectionString = process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function setup() {
  try {
    console.log("Database URL configured");
    console.log("Setting up database and test user...");

    const password = "Demo123456";
    const passwordHash = await bcrypt.hash(password, 10);

    const demoUsers = [
      { email: "demo.customer@rweezy.test", fullName: "Demo Customer", phone: "+919000000001", role: "customer" },
    ];

    for (const demoUser of demoUsers) {
      console.log(`Creating user: ${demoUser.email} | Phone: ${demoUser.phone} | Password: ${password} | Role: ${demoUser.role}`);

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
      console.log(`User created with ID: ${user.id}`);

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
    }

    await pool.end();
    console.log("Setup complete!");
  } catch (e) {
    console.error("Setup error:", e);
    await pool.end();
  }
}

setup();