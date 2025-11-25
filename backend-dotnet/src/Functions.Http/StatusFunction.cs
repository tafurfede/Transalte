using System.Net;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using Functions.Shared;
using Microsoft.Extensions.DependencyInjection;
using TranslateDemo.Application.UseCases;
using TranslateDemo.Domain.Entities;

namespace TranslateDemo.Functions.Http;

public class StatusFunction
{
    private readonly GetStatusUseCase _useCase;

    public StatusFunction() : this(Bootstrap.ServiceProvider.GetRequiredService<GetStatusUseCase>()) { }

    public StatusFunction(GetStatusUseCase useCase)
    {
        _useCase = useCase;
    }

    public async Task<APIGatewayProxyResponse> Handler(APIGatewayProxyRequest request, ILambdaContext context)
    {
        var jobId = request.PathParameters != null && request.PathParameters.TryGetValue("jobId", out var id) ? id : null;
        if (string.IsNullOrWhiteSpace(jobId))
        {
            return Response(HttpStatusCode.BadRequest, new { message = "jobId is required" });
        }

        try
        {
            var result = await _useCase.HandleAsync(jobId);
            return Response(HttpStatusCode.OK, new { job = ToDto(result.Job), downloadUrl = result.DownloadUrl });
        }
        catch (KeyNotFoundException)
        {
            return Response(HttpStatusCode.NotFound, new { message = "Job not found" });
        }
        catch (Exception ex)
        {
            context.Logger.LogError($"Status failed: {ex}");
            return Response(HttpStatusCode.InternalServerError, new { message = "Failed to fetch status" });
        }
    }

    private static APIGatewayProxyResponse Response(HttpStatusCode code, object body) => new()
    {
        StatusCode = (int)code,
        Headers = new Dictionary<string, string> { ["Access-Control-Allow-Origin"] = "*", ["Access-Control-Allow-Headers"] = "*" },
        Body = JsonSerializer.Serialize(body)
    };

    private static object ToDto(TranslationJob job) => new
    {
        jobId = job.JobId,
        fileName = job.FileName,
        inputKey = job.InputKey,
        outputKey = job.OutputKey,
        sourceLanguage = job.SourceLanguage,
        targetLanguage = job.TargetLanguage,
        outputFormat = job.OutputFormat.ToString().ToLowerInvariant(),
        contentType = job.ContentType,
        fileExtension = job.FileExtension,
        status = job.Status.ToString().ToUpperInvariant(),
        errorMessage = job.ErrorMessage,
        verificationStatus = job.VerificationStatus,
        verificationDetails = job.VerificationDetails,
        createdAt = job.CreatedAt.ToString("o"),
        updatedAt = job.UpdatedAt.ToString("o")
    };
}
