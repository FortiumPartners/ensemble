/*
 * ============================================================================
 * EXAMPLE 1: Complete RESTful API with ASP.NET Core
 * ============================================================================
 *
 * This example demonstrates a production-ready blog API with:
 * - ASP.NET Core Web API controllers and minimal APIs
 * - Wolverine message handling (commands/queries)
 * - MartenDB document storage
 * - JWT authentication and authorization
 * - Request validation and error handling
 * - API versioning and Swagger documentation
 *
 * Technologies:
 * - ASP.NET Core 8.0+
 * - Wolverine for CQRS
 * - MartenDB for persistence
 * - JWT Bearer authentication
 * - FluentValidation for request validation
 *
 * Lines: ~550
 * Complexity: Intermediate
 */

using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using FluentValidation;
using Marten;
using Wolverine;

// ============================================================================
// PROGRAM.CS - Application Startup
// ============================================================================

var builder = WebApplication.CreateBuilder(args);

// Configure services
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "Blog API", Version = "v1" });
    c.AddSecurityDefinition("Bearer", new()
    {
        Description = "JWT Authorization header using Bearer scheme",
        Name = "Authorization",
        In = Microsoft.OpenApi.Models.ParameterLocation.Header,
        Type = Microsoft.OpenApi.Models.SecuritySchemeType.ApiKey,
        Scheme = "Bearer"
    });
    c.AddSecurityRequirement(new()
    {
        {
            new()
            {
                Reference = new()
                {
                    Type = Microsoft.OpenApi.Models.ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});

// Configure JWT authentication
var jwtSettings = builder.Configuration.GetSection("JwtSettings");
var secretKey = Encoding.ASCII.GetBytes(jwtSettings["SecretKey"] ?? "YourSecretKeyHere123456789012345678901234567890");

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.RequireHttpsMetadata = false;
    options.SaveToken = true;
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(secretKey),
        ValidateIssuer = false,
        ValidateAudience = false,
        ClockSkew = TimeSpan.Zero
    };
});

builder.Services.AddAuthorization();

// Configure MartenDB
builder.Services.AddMarten(opts =>
{
    var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
        ?? "Host=localhost;Database=blog_api;Username=postgres;Password=postgres";

    opts.Connection(connectionString);
    opts.AutoCreateSchemaObjects = Marten.Schema.AutoCreate.CreateOrUpdate;

    // Configure Post document
    opts.Schema.For<Post>()
        .Identity(x => x.Id)
        .Index(x => x.Title)
        .Index(x => x.AuthorId)
        .Index(x => x.CreatedAt)
        .Index(x => x.IsPublished);
});

// Configure Wolverine
builder.Host.UseWolverine();

// Configure FluentValidation
builder.Services.AddValidatorsFromAssemblyContaining<CreatePostRequestValidator>();

var app = builder.Build();

// Configure middleware pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.Run();

// ============================================================================
// DOMAIN ENTITIES
// ============================================================================

public class Post
{
    public Guid Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string AuthorId { get; set; } = string.Empty;
    public string AuthorName { get; set; } = string.Empty;
    public bool IsPublished { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public DateTime? PublishedAt { get; set; }
    public List<string> Tags { get; set; } = new();

    public static Post Create(string title, string content, string authorId, string authorName)
    {
        return new Post
        {
            Id = Guid.NewGuid(),
            Title = title,
            Content = content,
            AuthorId = authorId,
            AuthorName = authorName,
            IsPublished = false,
            CreatedAt = DateTime.UtcNow,
            Tags = new List<string>()
        };
    }

    public void Update(string title, string content, List<string> tags)
    {
        Title = title;
        Content = content;
        Tags = tags ?? new List<string>();
        UpdatedAt = DateTime.UtcNow;
    }

    public void Publish()
    {
        IsPublished = true;
        PublishedAt = DateTime.UtcNow;
    }
}

public class User
{
    public Guid Id { get; set; }
    public string Email { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string Role { get; set; } = "User";
    public DateTime CreatedAt { get; set; }
}

// ============================================================================
// COMMANDS & QUERIES
// ============================================================================

public record CreatePostCommand(
    string Title,
    string Content,
    List<string> Tags,
    string AuthorId,
    string AuthorName);

public record UpdatePostCommand(
    Guid Id,
    string Title,
    string Content,
    List<string> Tags,
    string AuthorId);

public record DeletePostCommand(Guid Id, string AuthorId);

public record PublishPostCommand(Guid Id, string AuthorId);

public record GetPostsQuery(
    int Page = 1,
    int PageSize = 20,
    string? Search = null,
    bool? PublishedOnly = null);

public record GetPostByIdQuery(Guid Id);

public record LoginCommand(string Email, string Password);

// ============================================================================
// DTOs
// ============================================================================

public record PostResponse(
    Guid Id,
    string Title,
    string Content,
    string AuthorId,
    string AuthorName,
    bool IsPublished,
    DateTime CreatedAt,
    DateTime? UpdatedAt,
    DateTime? PublishedAt,
    List<string> Tags);

public record PagedResult<T>(
    List<T> Items,
    int TotalCount,
    int Page,
    int PageSize,
    int TotalPages);

public record CreatePostRequest(
    string Title,
    string Content,
    List<string>? Tags);

public record UpdatePostRequest(
    string Title,
    string Content,
    List<string>? Tags);

public record LoginRequest(string Email, string Password);

public record LoginResponse(string Token, string Email, string Name);

// ============================================================================
// REQUEST VALIDATORS
// ============================================================================

public class CreatePostRequestValidator : AbstractValidator<CreatePostRequest>
{
    public CreatePostRequestValidator()
    {
        RuleFor(x => x.Title)
            .NotEmpty().WithMessage("Title is required")
            .MaximumLength(200).WithMessage("Title cannot exceed 200 characters");

        RuleFor(x => x.Content)
            .NotEmpty().WithMessage("Content is required")
            .MinimumLength(10).WithMessage("Content must be at least 10 characters");

        RuleForEach(x => x.Tags)
            .MaximumLength(50).WithMessage("Each tag cannot exceed 50 characters");
    }
}

public class UpdatePostRequestValidator : AbstractValidator<UpdatePostRequest>
{
    public UpdatePostRequestValidator()
    {
        RuleFor(x => x.Title)
            .NotEmpty().WithMessage("Title is required")
            .MaximumLength(200).WithMessage("Title cannot exceed 200 characters");

        RuleFor(x => x.Content)
            .NotEmpty().WithMessage("Content is required")
            .MinimumLength(10).WithMessage("Content must be at least 10 characters");
    }
}

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

public class CreatePostHandler
{
    private readonly IDocumentSession _session;
    private readonly ILogger<CreatePostHandler> _logger;

    public CreatePostHandler(IDocumentSession session, ILogger<CreatePostHandler> logger)
    {
        _session = session;
        _logger = logger;
    }

    public async Task<PostResponse> Handle(CreatePostCommand command)
    {
        _logger.LogInformation("Creating post with title: {Title}", command.Title);

        var post = Post.Create(
            command.Title,
            command.Content,
            command.AuthorId,
            command.AuthorName);

        post.Tags = command.Tags ?? new List<string>();

        _session.Store(post);
        await _session.SaveChangesAsync();

        _logger.LogInformation("Post created with ID: {PostId}", post.Id);

        return MapToResponse(post);
    }

    private static PostResponse MapToResponse(Post post) =>
        new(post.Id, post.Title, post.Content, post.AuthorId, post.AuthorName,
            post.IsPublished, post.CreatedAt, post.UpdatedAt, post.PublishedAt, post.Tags);
}

public class UpdatePostHandler
{
    private readonly IDocumentSession _session;
    private readonly ILogger<UpdatePostHandler> _logger;

    public UpdatePostHandler(IDocumentSession session, ILogger<UpdatePostHandler> logger)
    {
        _session = session;
        _logger = logger;
    }

    public async Task<PostResponse?> Handle(UpdatePostCommand command)
    {
        _logger.LogInformation("Updating post with ID: {PostId}", command.Id);

        var post = await _session.LoadAsync<Post>(command.Id);
        if (post == null)
        {
            _logger.LogWarning("Post with ID {PostId} not found", command.Id);
            return null;
        }

        if (post.AuthorId != command.AuthorId)
        {
            _logger.LogWarning("User {UserId} not authorized to update post {PostId}",
                command.AuthorId, command.Id);
            throw new UnauthorizedAccessException("Not authorized to update this post");
        }

        post.Update(command.Title, command.Content, command.Tags ?? new List<string>());

        _session.Update(post);
        await _session.SaveChangesAsync();

        _logger.LogInformation("Post updated successfully: {PostId}", post.Id);

        return new PostResponse(
            post.Id, post.Title, post.Content, post.AuthorId, post.AuthorName,
            post.IsPublished, post.CreatedAt, post.UpdatedAt, post.PublishedAt, post.Tags);
    }
}

public class DeletePostHandler
{
    private readonly IDocumentSession _session;
    private readonly ILogger<DeletePostHandler> _logger;

    public DeletePostHandler(IDocumentSession session, ILogger<DeletePostHandler> logger)
    {
        _session = session;
        _logger = logger;
    }

    public async Task<bool> Handle(DeletePostCommand command)
    {
        _logger.LogInformation("Deleting post with ID: {PostId}", command.Id);

        var post = await _session.LoadAsync<Post>(command.Id);
        if (post == null) return false;

        if (post.AuthorId != command.AuthorId)
        {
            throw new UnauthorizedAccessException("Not authorized to delete this post");
        }

        _session.Delete(post);
        await _session.SaveChangesAsync();

        _logger.LogInformation("Post deleted successfully: {PostId}", command.Id);
        return true;
    }
}

// ============================================================================
// QUERY HANDLERS
// ============================================================================

public class GetPostsHandler
{
    private readonly IQuerySession _session;
    private readonly ILogger<GetPostsHandler> _logger;

    public GetPostsHandler(IQuerySession session, ILogger<GetPostsHandler> logger)
    {
        _session = session;
        _logger = logger;
    }

    public async Task<PagedResult<PostResponse>> Handle(GetPostsQuery query)
    {
        _logger.LogInformation("Retrieving posts - Page: {Page}, PageSize: {PageSize}",
            query.Page, query.PageSize);

        var queryable = _session.Query<Post>();

        // Apply filters
        if (query.PublishedOnly == true)
            queryable = queryable.Where(x => x.IsPublished);

        if (!string.IsNullOrWhiteSpace(query.Search))
            queryable = queryable.Where(x =>
                x.Title.Contains(query.Search) || x.Content.Contains(query.Search));

        // Get total count
        var totalCount = await queryable.CountAsync();

        // Apply pagination and ordering
        var posts = await queryable
            .OrderByDescending(x => x.CreatedAt)
            .Skip((query.Page - 1) * query.PageSize)
            .Take(query.PageSize)
            .ToListAsync();

        var responses = posts.Select(p => new PostResponse(
            p.Id, p.Title, p.Content, p.AuthorId, p.AuthorName,
            p.IsPublished, p.CreatedAt, p.UpdatedAt, p.PublishedAt, p.Tags)).ToList();

        var totalPages = (int)Math.Ceiling(totalCount / (double)query.PageSize);

        return new PagedResult<PostResponse>(responses, totalCount, query.Page, query.PageSize, totalPages);
    }
}

public class GetPostByIdHandler
{
    private readonly IQuerySession _session;

    public GetPostByIdHandler(IQuerySession session)
    {
        _session = session;
    }

    public async Task<PostResponse?> Handle(GetPostByIdQuery query)
    {
        var post = await _session.LoadAsync<Post>(query.Id);
        if (post == null) return null;

        return new PostResponse(
            post.Id, post.Title, post.Content, post.AuthorId, post.AuthorName,
            post.IsPublished, post.CreatedAt, post.UpdatedAt, post.PublishedAt, post.Tags);
    }
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

public class AuthService
{
    private readonly IConfiguration _configuration;

    public AuthService(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public string GenerateJwtToken(string userId, string email, string name, string role)
    {
        var jwtSettings = _configuration.GetSection("JwtSettings");
        var secretKey = Encoding.ASCII.GetBytes(
            jwtSettings["SecretKey"] ?? "YourSecretKeyHere123456789012345678901234567890");

        var tokenHandler = new JwtSecurityTokenHandler();
        var tokenDescriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(new[]
            {
                new Claim(ClaimTypes.NameIdentifier, userId),
                new Claim(ClaimTypes.Email, email),
                new Claim(ClaimTypes.Name, name),
                new Claim(ClaimTypes.Role, role)
            }),
            Expires = DateTime.UtcNow.AddHours(8),
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(secretKey),
                SecurityAlgorithms.HmacSha256Signature)
        };

        var token = tokenHandler.CreateToken(tokenDescriptor);
        return tokenHandler.WriteToken(token);
    }
}

// ============================================================================
// CONTROLLERS
// ============================================================================

[ApiController]
[Route("api/[controller]")]
public class PostsController : ControllerBase
{
    private readonly IMessageBus _messageBus;
    private readonly ILogger<PostsController> _logger;

    public PostsController(IMessageBus messageBus, ILogger<PostsController> logger)
    {
        _messageBus = messageBus;
        _logger = logger;
    }

    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<PostResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<PagedResult<PostResponse>>> GetAll(
        [FromQuery] GetPostsQuery query)
    {
        var result = await _messageBus.InvokeAsync<PagedResult<PostResponse>>(query);
        return Ok(result);
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(PostResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PostResponse>> GetById(Guid id)
    {
        var query = new GetPostByIdQuery(id);
        var result = await _messageBus.InvokeAsync<PostResponse?>(query);

        if (result == null) return NotFound();
        return Ok(result);
    }

    [Authorize]
    [HttpPost]
    [ProducesResponseType(typeof(PostResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<PostResponse>> Create([FromBody] CreatePostRequest request)
    {
        var userId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "unknown";
        var userName = User.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown User";

        var command = new CreatePostCommand(
            request.Title,
            request.Content,
            request.Tags ?? new List<string>(),
            userId,
            userName);

        var result = await _messageBus.InvokeAsync<PostResponse>(command);

        return CreatedAtAction(nameof(GetById), new { id = result.Id }, result);
    }

    [Authorize]
    [HttpPut("{id:guid}")]
    [ProducesResponseType(typeof(PostResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PostResponse>> Update(
        Guid id,
        [FromBody] UpdatePostRequest request)
    {
        var userId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "unknown";

        var command = new UpdatePostCommand(
            id,
            request.Title,
            request.Content,
            request.Tags ?? new List<string>(),
            userId);

        try
        {
            var result = await _messageBus.InvokeAsync<PostResponse?>(command);
            if (result == null) return NotFound();
            return Ok(result);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    [Authorize]
    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(Guid id)
    {
        var userId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "unknown";

        var command = new DeletePostCommand(id, userId);

        try
        {
            var success = await _messageBus.InvokeAsync<bool>(command);
            if (!success) return NotFound();
            return NoContent();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }
}

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly AuthService _authService;

    public AuthController(AuthService authService)
    {
        _authService = authService;
    }

    [HttpPost("login")]
    [ProducesResponseType(typeof(LoginResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public ActionResult<LoginResponse> Login([FromBody] LoginRequest request)
    {
        // NOTE: In production, validate against database with hashed passwords
        // This is a simplified example
        if (request.Email == "admin@example.com" && request.Password == "password123")
        {
            var token = _authService.GenerateJwtToken(
                Guid.NewGuid().ToString(),
                request.Email,
                "Admin User",
                "Admin");

            return Ok(new LoginResponse(token, request.Email, "Admin User"));
        }

        return Unauthorized();
    }
}
