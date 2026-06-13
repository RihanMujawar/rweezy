import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const passwordHash = await bcrypt.hash('Demo123456', 10);

  // 1. Create Admin
  const admin = await prisma.user.upsert({
    where: { email: 'admin@rweezy.com' },
    update: {},
    create: {
      email: 'admin@rweezy.com',
      passwordHash,
      profile: {
        create: {
          fullName: 'Platform Admin',
          phone: '+919999999999'
        }
      },
      roles: {
        createMany: {
          data: [
            { role: 'admin' },
            { role: 'customer' }
          ]
        }
      }
    }
  });

  // 2. Create a Restaurant Manager and Restaurant
  const hotelManager = await prisma.user.upsert({
    where: { email: 'hotel@rweezy.com' },
    update: {},
    create: {
      email: 'hotel@rweezy.com',
      passwordHash,
      profile: {
        create: {
          fullName: 'Hotel Manager',
          phone: '+918888888888'
        }
      },
      roles: {
        createMany: {
          data: [
            { role: 'hotel_manager' },
            { role: 'customer' }
          ]
        }
      }
    }
  });

  const restaurant = await prisma.restaurant.create({
    data: {
      managerId: hotelManager.id,
      name: 'Rweezy Delights',
      description: 'The best food in town',
      address: '123 Food Street, Bangalore',
      isOpen: true,
      menuItems: {
        createMany: {
          data: [
            { name: 'Classic Burger', price: 150, category: 'Fast Food', isVeg: false },
            { name: 'Veg Pizza', price: 250, category: 'Main Course', isVeg: true },
            { name: 'Coca Cola', price: 50, category: 'Beverages', isVeg: true }
          ]
        }
      }
    }
  });

  // 3. Create a Grocery Store Manager and Store
  const groceryManager = await prisma.user.upsert({
    where: { email: 'grocery@rweezy.com' },
    update: {},
    create: {
      email: 'grocery@rweezy.com',
      passwordHash,
      profile: {
        create: {
          fullName: 'Grocery Manager',
          phone: '+917777777777'
        }
      },
      roles: {
        createMany: {
          data: [
            { role: 'grocery_manager' },
            { role: 'customer' }
          ]
        }
      }
    }
  });

  await prisma.groceryStore.create({
    data: {
      managerId: groceryManager.id,
      name: 'Rweezy Mart',
      description: 'Your neighborhood store',
      address: '456 Supply Road, Bangalore',
      isOpen: true,
      groceryItems: {
        createMany: {
          data: [
            { name: 'Milk 1L', price: 60, category: 'Dairy', stockQuantity: 100, unit: 'bottle' },
            { name: 'Bread', price: 40, category: 'Bakery', stockQuantity: 50, unit: 'packet' },
            { name: 'Eggs (12)', price: 80, category: 'Dairy', stockQuantity: 30, unit: 'dozen' }
          ]
        }
      }
    }
  });

  // 4. Create a Rider/Delivery Boy
  await prisma.user.upsert({
    where: { email: 'rider@rweezy.com' },
    update: {},
    create: {
      email: 'rider@rweezy.com',
      passwordHash,
      profile: {
        create: {
          fullName: 'Swift Rider',
          phone: '+916666666666'
        }
      },
      roles: {
        createMany: {
          data: [
            { role: 'rider' },
            { role: 'delivery_boy' },
            { role: 'customer' }
          ]
        }
      }
    }
  });

  // 5. Default Platform Settings
  await prisma.platformSetting.upsert({
    where: { key: 'fees' },
    update: {},
    create: {
      key: 'fees',
      value: { flat_platform_fee: 10 }
    }
  });

  console.log('Seeding complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
