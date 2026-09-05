import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const skills = [
  ['travel-postcard', '旅行明信片', '把旅行照片变成电影感明信片', 'travel'],
  ['movie-poster', '电影海报', '把人物照片变成电影海报', 'poster'],
  ['magazine-cover', '杂志封面', '生成高级杂志封面', 'editorial'],
  ['film-photo', '90 年代胶片', '自然的复古胶片摄影', 'photo'],
  ['album-cover', '专辑封面', '把照片变成音乐专辑封面', 'music'],
  ['polaroid', '拍立得', '一张有日期和手写区域的拍立得', 'memory'],
  ['couple-memory', '情侣纪念卡', '记录两个人的特别时刻', 'couple'],
  ['ai-avatar', 'AI 高级头像', '适合社交资料的高级头像', 'avatar'],
] as const;

async function seed(): Promise<void> {
  await prisma.user.upsert({
    where: { id: 'dev-user' },
    update: { nickname: '开发用户' },
    create: { id: 'dev-user', nickname: '开发用户' },
  });
  await prisma.aiProvider.upsert({
    where: { id: 'mock' },
    update: {},
    create: { id: 'mock', type: 'mock', name: 'Mock Provider' },
  });
  await prisma.aiProvider.upsert({
    where: { id: 'openai' },
    update: {},
    create: { id: 'openai', type: 'openai', name: 'OpenAI' },
  });
  await prisma.aiModel.upsert({
    where: { id: 'image-default' },
    update: {},
    create: { id: 'image-default', providerId: 'mock', name: 'image-default' },
  });

  for (const [id, name, description, category] of skills) {
    const skill = await prisma.skill.upsert({
      where: { id },
      update: {
        name,
        description,
        category,
        status: 'PUBLISHED',
        currentVersion: '1.0.0',
      },
      create: {
        id,
        slug: id,
        name,
        description,
        category,
        status: 'PUBLISHED',
        currentVersion: '1.0.0',
      },
    });
    await prisma.skillVersion.upsert({
      where: { skillId_version: { skillId: skill.id, version: '1.0.0' } },
      update: {
        status: 'PUBLISHED',
        skillManifest: { id, name, version: '1.0.0' },
      },
      create: {
        skillId: skill.id,
        version: '1.0.0',
        status: 'PUBLISHED',
        skillManifest: { id, name, version: '1.0.0' },
        providerId: 'mock',
        modelId: 'image-default',
      },
    });
  }
}

seed().finally(() => prisma.$disconnect());
