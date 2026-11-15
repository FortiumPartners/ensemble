// The only place that reads process.env: everything else goes through ConfigService.
export default () => ({
  database: { url: process.env.DATABASE_URL },
  auth: { jwtSecret: process.env.JWT_SECRET ?? 'dev-secret' },
  projects: { pageSize: parseInt(process.env.PROJECTS_PAGE_SIZE ?? '20', 10) },
});
