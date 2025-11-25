using System.Net;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using Functions.Shared;
using Microsoft.Extensions.DependencyInjection;
using TranslateDemo.Application.Contracts;
using TranslateDemo.Application.UseCases;
using TranslateDemo.Domain.Abstractions;

namespace TranslateDemo.Functions.Http;

public class ProcessJobFunction
{
    private readonly ProcessUploadUseCase _useCase;
    private readonly IJobRepository _jobs;
    private readonly string _bucket;

    public ProcessJobFunction() : this(
        Bootstrap.ServiceProvider.GetRequiredService<ProcessUploadUseCase>(),
        Bootstrap.ServiceProvider.GetRequiredService<IJobRepository>(),
        Environment.GetEnvironmentVariable("BUCKET") ?? string.Empty)
    { }

    public ProcessJobFunction(ProcessUploadUseCase useCase, IJobRepository jobs, string bucket)
    {
        _useCase = useCase;
        _jobs = jobs;
        _bucket = bucket;
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
            var job = await _jobs.GetAsync(jobId);
            if (job == null || string.IsNullOrWhiteSpace(job.InputKey))
            {
                return Response(HttpStatusCode.NotFound, new { message = "Job not found" });
            }

            await _useCase.HandleAsync(new ProcessUploadRequest(_bucket, job.InputKey));

            return Response(HttpStatusCode.OK, new { message = "Processing started" });
        }
        catch (Exception ex)
        {
            context.Logger.LogError($"Process job failed: {ex}");
            return Response(HttpStatusCode.InternalServerError, new { message = "Failed to start processing" });
        }
    }

    private static APIGatewayProxyResponse Response(HttpStatusCode code, object body) => new()
    {
        StatusCode = (int)code,
        Headers = new Dictionary<string, string> { ["Access-Control-Allow-Origin"] = "*", ["Access-Control-Allow-Headers"] = "*" },
        Body = JsonSerializer.Serialize(body)
    };
}

