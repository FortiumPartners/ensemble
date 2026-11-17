import { useProjects } from '../api/projects';

export function ProjectList() {
  const { data, isPending, isError } = useProjects();

  if (isPending) return <p role="status">Loading projects...</p>;
  if (isError) return <p role="alert">Could not load projects.</p>;

  return (
    <section aria-labelledby="projects-heading">
      <h2 id="projects-heading">Projects</h2>
      <ul>
        {data.map((project) => (
          <li key={project.id}>{project.name}</li>
        ))}
      </ul>
    </section>
  );
}
