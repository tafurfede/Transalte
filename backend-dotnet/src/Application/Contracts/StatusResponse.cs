using TranslateDemo.Domain.Entities;

namespace TranslateDemo.Application.Contracts;

public sealed record StatusResponse(TranslationJob Job, string? DownloadUrl);

