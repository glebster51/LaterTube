@echo off
setlocal
set "WRAPPER_DIR=%~dp0gradle\wrapper"
set "WRAPPER_JAR=%WRAPPER_DIR%\gradle-wrapper.jar"
if not exist "%WRAPPER_JAR%" (
  echo Missing %WRAPPER_JAR%
  echo Run tools\download-gradle-wrapper.ps1 once, then retry.
  exit /b 1
)
if "%JAVA_HOME%"=="" set "JAVA_HOME=C:\Program Files\Unity\Hub\Editor\6000.3.10f1\Editor\Data\PlaybackEngines\AndroidPlayer\OpenJDK"
"%JAVA_HOME%\bin\java.exe" -classpath "%WRAPPER_JAR%" org.gradle.wrapper.GradleWrapperMain %*
