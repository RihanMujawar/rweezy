require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

prisma.user.findUnique({ where: { id: 'test' } })
  .then(() => console.log('Query works!'))
  .catch(e => console.error('Error:', e.message))
  .finally(() => prisma.$disconnect());