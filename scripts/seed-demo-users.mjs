import { prisma } from "../backend/lib/prisma.mjs";
import { hashPassword } from "../backend/lib/auth.mjs";

const password = process.env.DEMO_PASSWORD || "Demo123456";

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

async function seed() {
  const passwordHash = await hashPassword(password);

  for (const demoUser of demoUsers) {
    try {
      const user = await prisma.user.upsert({
        where: { email: demoUser.email },
        update: {
            passwordHash,
        },
        create: {
            email: demoUser.email,
            passwordHash,
            profile: {
                create: {
                    fullName: demoUser.fullName,
                    phone: demoUser.phone,
                }
            },
            roles: {
                create: {
                    role: demoUser.role
                }
            }
        }
      });
      console.log(`Seeded: ${demoUser.email} / ${password} -> ${demoUser.role}`);
    } catch (error) {
      console.error(`Failed to seed ${demoUser.email}:`, error.message);
    }
  }
}

seed()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
